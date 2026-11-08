package dev.jpv.intellij

import com.google.gson.Gson
import com.intellij.ide.ui.LafManagerListener
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
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
import java.awt.Cursor
import java.beans.PropertyChangeListener
import javax.swing.JComponent

private const val DEBOUNCE_MS = 200
private const val WRAP_KEY = "jpv.wrap"

/** Whether diagrams wrap to the window width. Shared by the whole IDE. */
internal var wrapDiagram: Boolean
    get() = PropertiesComponent.getInstance().getBoolean(WRAP_KEY, true)
    set(value) = PropertiesComponent.getInstance().setValue(WRAP_KEY, value, true)

/** Shows the pipeline drawing for [document] and redraws it as the document or IDE theme changes. */
class PipelinePreview(private val file: VirtualFile, private val document: Document) :
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
    private val renders = Alarm(Alarm.ThreadToUse.SWING_THREAD, this)
    private val gson = Gson()

    @Volatile
    private var pageLoaded = false

    private var caretOffset = 0

    init {
        open.add(this)
        Disposer.register(this, browser)
        Disposer.register(this, stageClicks)
        Disposer.register(this, stageHovers)

        // Runs on a CEF thread.
        stageClicks.addHandler { request ->
            request.toIntOrNull()?.let { offset ->
                ApplicationManager.getApplication().invokeLater { onStageClick?.invoke(offset) }
            }
            null
        }

        // Runs on a CEF thread.
        stageHovers.addHandler { request ->
            val type = if (request == "true") Cursor.HAND_CURSOR else Cursor.DEFAULT_CURSOR
            ApplicationManager.getApplication().invokeLater {
                browser.cefBrowser.uiComponent.cursor = Cursor.getPredefinedCursor(type)
            }
            null
        }

        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                if (!frame.isMain) return
                val bridge = "window.jpvHost = { onSelect: function (range) { " +
                    stageClicks.inject("String(range.start)") + " }, onHover: function (clickable) { " +
                    stageHovers.inject("String(clickable)") + " } };"
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
            "window.jpvView.setSource(${gson.toJson(document.text)});"
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
