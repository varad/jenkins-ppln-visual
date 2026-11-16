package dev.jpv.intellij

import com.google.gson.Gson
import com.intellij.ide.ui.LafManagerListener
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.ui.ColorUtil
import com.intellij.ui.JBColor
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.Alarm
import com.intellij.util.ui.UIUtil
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.AWTEvent
import java.awt.Cursor
import java.awt.Toolkit
import java.awt.event.AWTEventListener
import java.awt.event.MouseEvent
import java.beans.PropertyChangeListener
import javax.swing.JComponent
import javax.swing.SwingUtilities

private const val DEBOUNCE_MS = 200

/** How long after a mouse release the page gets to end a drag itself before the IDE ends it. */
private const val RELEASE_GRACE_MS = 150
private const val WRAP_KEY = "jpv.wrap"

/** Whether diagrams wrap to the window width. Shared by the whole IDE. */
internal var wrapDiagram: Boolean
    get() = PropertiesComponent.getInstance().getBoolean(WRAP_KEY, true)
    set(value) = PropertiesComponent.getInstance().setValue(WRAP_KEY, value, true)

/**
 * A stage move, rename or removal in the diagram, as one replacement made against the document at [version] (its modification stamp).
 * [label] names the undoable command.
 */
private class StageEdit(val start: Int, val end: Int, val text: String?, val version: Long, val select: Int, val label: String?)

/** Shows the pipeline drawing for [document] and redraws it as the document or IDE theme changes. */
class PipelinePreview(private val project: Project, private val file: VirtualFile, private val document: Document) :
    UserDataHolderBase(), FileEditor {

    companion object {
        /** Previews that are still open. Only touched on the EDT. */
        private val open = LinkedHashSet<PipelinePreview>()

        /** Redraws every open preview, e.g. after the wrap setting changed. */
        fun refreshAll() = open.toList().forEach { it.refresh() }
    }

    /** Called on the EDT with the document offset of the stage or post block the user clicked. */
    var onStageClick: ((Int) -> Unit)? = null

    // Off-screen, so the IDE sets the mouse cursor: a windowed browser stops updating it once a click
    // has moved focus to the code pane. Falls back to windowed if the registry turns off-screen off.
    private val browser = JBCefBrowser.createBuilder()
        .setOffScreenRendering(JBCefApp.isOffScreenRenderingModeEnabled())
        .build()

    // Must be created before the CEF browser starts, which happens once the component is shown.
    private val stageClicks = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val stageHovers = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val stageMoves = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val focusRequests = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val pageErrors = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val renders = Alarm(Alarm.ThreadToUse.SWING_THREAD, this)
    private val releases = Alarm(Alarm.ThreadToUse.SWING_THREAD, this)
    private val gson = Gson()

    @Volatile
    private var pageLoaded = false

    /** The page is dragging a stage; it reports the grabbing cursor for exactly that long. */
    @Volatile
    private var pageDragging = false

    private var caretOffset = 0

    init {
        open.add(this)
        Disposer.register(this, browser)
        Disposer.register(this, stageClicks)
        Disposer.register(this, stageHovers)
        Disposer.register(this, stageMoves)
        Disposer.register(this, focusRequests)
        Disposer.register(this, pageErrors)

        // Runs on a CEF thread.
        stageClicks.addHandler { request ->
            request.toIntOrNull()?.let { offset ->
                ApplicationManager.getApplication().invokeLater { onStageClick?.invoke(offset) }
            }
            null
        }

        // Runs on a CEF thread.
        stageHovers.addHandler { request ->
            pageDragging = request == "grabbing"
            val type = when (request) {
                "pointer", "grab" -> Cursor.HAND_CURSOR
                "grabbing" -> Cursor.MOVE_CURSOR
                "text" -> Cursor.TEXT_CURSOR
                else -> Cursor.DEFAULT_CURSOR
            }
            ApplicationManager.getApplication().invokeLater {
                browser.cefBrowser.uiComponent.cursor = Cursor.getPredefinedCursor(type)
            }
            null
        }

        // Runs on a CEF thread.
        stageMoves.addHandler { request ->
            runCatching { gson.fromJson(request, StageEdit::class.java) }.getOrNull()?.let { edit ->
                ApplicationManager.getApplication().invokeLater { applyEdit(edit) }
            }
            null
        }

        // Runs on a CEF thread. Queued after the caret moves of the clicks before a double-click,
        // which focus the text editor, so the diagram's name box ends up with the keyboard.
        focusRequests.addHandler {
            ApplicationManager.getApplication().invokeLater {
                IdeFocusManager.getGlobalInstance().requestFocus(browser.component, true)
            }
            null
        }

        // Runs on a CEF thread.
        pageErrors.addHandler { request ->
            thisLogger().warn("Jenkinsfile preview: $request")
            null
        }

        // A popup that shows up mid-drag, like a notification balloon, can take the mouse release, so the page
        // never sees it and the drag hangs. The IDE sees every release: if the page is still dragging shortly
        // after one, tell it to drop (released over the diagram) or cancel (released anywhere else).
        val releaseWatcher = AWTEventListener { event ->
            if (event.id != MouseEvent.MOUSE_RELEASED || !pageDragging) return@AWTEventListener
            val inside = SwingUtilities.isDescendingFrom((event as MouseEvent).component, browser.component)
            releases.cancelAllRequests()
            releases.addRequest({
                if (pageDragging && pageLoaded) {
                    browser.cefBrowser.executeJavaScript("window.jpvView.releasePointer($inside);", browser.cefBrowser.url, 0)
                }
            }, RELEASE_GRACE_MS)
        }
        Toolkit.getDefaultToolkit().addAWTEventListener(releaseWatcher, AWTEvent.MOUSE_EVENT_MASK)
        Disposer.register(this) { Toolkit.getDefaultToolkit().removeAWTEventListener(releaseWatcher) }

        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                if (!frame.isMain) return
                val bridge = "window.jpvHost = { onSelect: function (range) { " +
                    stageClicks.inject("String(range.start)") + " }, onCursor: function (cursor) { " +
                    stageHovers.inject("cursor") + " }, onEdit: function (edit) { " +
                    stageMoves.inject("JSON.stringify(edit)") + " }, onFocus: function () { " +
                    focusRequests.inject("''") + " }, onError: function (message) { " +
                    pageErrors.inject("message") + " } };"
                cefBrowser.executeJavaScript(bridge, cefBrowser.url, 0)
                pageLoaded = true
                scheduleRender(0)
            }
        }, browser.cefBrowser)

        document.addDocumentListener(object : DocumentListener {
            override fun documentChanged(event: DocumentEvent) = scheduleRender(DEBOUNCE_MS)
        }, this)

        ApplicationManager.getApplication().messageBus.connect(this)
            .subscribe(LafManagerListener.TOPIC, LafManagerListener { scheduleRender(0) })

        browser.loadHTML(loadPage())
    }

    private fun loadPage(): String {
        val page = javaClass.getResourceAsStream("/webview/embed.html")
            ?: error("webview/embed.html is missing from the plugin")
        return page.use { it.readBytes().toString(Charsets.UTF_8) }
    }

    fun refresh() = scheduleRender(0)

    /** Call on the EDT. Rings the innermost stage containing [offset] in the diagram, if there is one. */
    fun highlightStageAt(offset: Int) {
        caretOffset = offset
        if (pageLoaded) browser.cefBrowser.executeJavaScript("window.jpvView.setCaret($offset);", browser.cefBrowser.url, 0)
    }

    /** Call on the EDT. Makes a stage move, rename or removal from the diagram an undoable edit, unless the document changed meanwhile. */
    private fun applyEdit(edit: StageEdit) {
        val text = edit.text
        val valid = text != null && edit.version == document.modificationStamp && document.isWritable &&
            edit.start in 0..edit.end && edit.end <= document.textLength
        if (valid) {
            WriteCommandAction.runWriteCommandAction(project, edit.label ?: "Move Stage", null, {
                document.replaceString(edit.start, edit.end, text!!)
            })
            if (edit.select >= 0) onStageClick?.invoke(edit.select) // a removal has nothing to select
        }
        // The diagram already shows the edit; redraw from the document either way so they agree.
        scheduleRender(0)
    }

    private fun scheduleRender(delayMs: Int) {
        renders.cancelAllRequests()
        renders.addRequest(::render, delayMs)
    }

    private fun render() {
        if (!pageLoaded) return
        val background = "#" + ColorUtil.toHex(UIUtil.getPanelBackground())
        val script = "window.jpvView.setTheme(${!JBColor.isBright()}, '$background');" +
            "window.jpvView.setWrap($wrapDiagram);" +
            "window.jpvView.setCaret($caretOffset);" +
            "window.jpvView.setSource(${gson.toJson(document.text)}, ${document.modificationStamp});"
        browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }

    override fun getComponent(): JComponent = browser.component
    override fun getPreferredFocusedComponent(): JComponent = browser.component
    override fun getName() = "View"
    override fun getFile() = file
    override fun setState(state: FileEditorState) = Unit
    override fun isModified() = false
    override fun isValid() = file.isValid
    override fun addPropertyChangeListener(listener: PropertyChangeListener) = Unit
    override fun removePropertyChangeListener(listener: PropertyChangeListener) = Unit
    override fun getCurrentLocation() = null
    override fun dispose() {
        open.remove(this)
        onStageClick = null
    }
}
