package dev.jpv.intellij

import com.google.gson.Gson
import com.intellij.ide.ui.LafManagerListener
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
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.Alarm
import com.intellij.util.ui.UIUtil
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.beans.PropertyChangeListener
import javax.swing.JComponent

private const val DEBOUNCE_MS = 200

/** Shows the pipeline drawing for [document] and redraws it as the document or IDE theme changes. */
class PipelinePreview(private val file: VirtualFile, private val document: Document) :
    UserDataHolderBase(), FileEditor {

    private val browser = JBCefBrowser()
    private val renders = Alarm(Alarm.ThreadToUse.SWING_THREAD, this)
    private val gson = Gson()

    @Volatile
    private var pageLoaded = false

    init {
        Disposer.register(this, browser)

        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                if (!frame.isMain) return
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

    private fun scheduleRender(delayMs: Int) {
        renders.cancelAllRequests()
        renders.addRequest(::render, delayMs)
    }

    private fun render() {
        if (!pageLoaded) return
        val background = "#" + ColorUtil.toHex(UIUtil.getPanelBackground())
        val script = "window.jpvView.setTheme(${!JBColor.isBright()}, '$background');" +
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
    override fun dispose() = Unit
}
