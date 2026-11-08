package dev.jpv.intellij

import com.intellij.icons.AllIcons
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.Separator
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.TextEditorWithPreview
import com.intellij.openapi.fileEditor.impl.text.TextEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.ui.JBSplitter
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.jcef.JBCefApp
import javax.swing.Icon
import javax.swing.JComponent

private const val LAYOUT_KEY = "jpv.layout"

/** The Code / View / Dual mode. Shared by every Jenkinsfile and kept across IDE restarts. */
internal var layoutMode: TextEditorWithPreview.Layout
    get() = PropertiesComponent.getInstance().getValue(LAYOUT_KEY)
        ?.let { name -> TextEditorWithPreview.Layout.entries.firstOrNull { it.name == name } }
        ?: TextEditorWithPreview.Layout.SHOW_EDITOR
    set(value) = PropertiesComponent.getInstance().setValue(LAYOUT_KEY, value.name)

class JenkinsfileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean =
        !file.isDirectory && isJenkinsfile(file.name) && JBCefApp.isSupported()

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        val code = TextEditorProvider.getInstance().createEditor(project, file) as TextEditor
        val document = FileDocumentManager.getInstance().getDocument(file)!!
        return JenkinsfileEditor(code, PipelinePreview(file, document))
    }

    override fun getEditorTypeId() = "jenkinsfile-visualizer"

    override fun getPolicy() = FileEditorPolicy.HIDE_DEFAULT_EDITOR

    private fun isJenkinsfile(name: String) =
        name.equals("Jenkinsfile", ignoreCase = true) ||
            name.endsWith(".Jenkinsfile", ignoreCase = true) ||
            name.startsWith("Jenkinsfile.", ignoreCase = true)
}

private class JenkinsfileEditor(code: TextEditor, private val view: PipelinePreview) :
    // Code above the diagram (isVerticalSplit): pipeline drawings are wide, so they need the full width.
    TextEditorWithPreview(code, view, "Jenkinsfile", Layout.SHOW_EDITOR, true) {

    init {
        // The base class restores whatever mode this editor used last. Apply the shared mode instead,
        // so every Jenkinsfile opens in the same mode, including after an IDE restart.
        setLayout(layoutMode)
        view.onStageClick = { offset -> if (getLayout() == Layout.SHOW_EDITOR_AND_PREVIEW) moveCaretTo(offset) }
        textEditor.editor.caretModel.addCaretListener(object : CaretListener {
            override fun caretPositionChanged(event: CaretEvent) {
                view.highlightStageAt(textEditor.editor.caretModel.offset)
            }
        }, this)
    }

    private fun moveCaretTo(offset: Int) {
        val editor = textEditor.editor
        // The diagram can lag behind the text by the redraw delay, so the offset may be past the end.
        editor.caretModel.moveToOffset(offset.coerceAtMost(editor.document.textLength))
        editor.selectionModel.removeSelection()
        editor.scrollingModel.scrollToCaret(ScrollType.CENTER)
        // An unfocused editor doesn't show its caret.
        IdeFocusManager.getGlobalInstance().requestFocus(editor.contentComponent, true)
    }

    override fun setState(state: FileEditorState) {
        super.setState(state)
        // The saved state holds the mode this file used last. Re-apply the shared mode after it.
        setLayout(layoutMode)
    }

    override fun getComponent(): JComponent {
        val component = super.getComponent()
        // The base class builds the component from its own per-file layout setting, which can
        // overwrite the shared mode set in init. Put the shared mode back when they differ.
        if (getLayout() != layoutMode) setLayout(layoutMode)
        return component
    }

    // The base class ignores isVerticalSplit when it builds the splitter, so ask for a vertical one here.
    override fun createSplitter(): JBSplitter = OnePixelSplitter(true)

    override val isShowFloatingToolbar: Boolean
        get() = false

    override fun createViewActionGroup(): ActionGroup = DefaultActionGroup(
        ModeAction("Code", AllIcons.General.LayoutEditorOnly, Layout.SHOW_EDITOR),
        ModeAction("View", AllIcons.General.LayoutPreviewOnly, Layout.SHOW_PREVIEW),
        ModeAction("Dual", AllIcons.General.LayoutEditorPreview, Layout.SHOW_EDITOR_AND_PREVIEW),
        Separator.getInstance(),
        WrapAction(),
    )

    private inner class ModeAction(text: String, icon: Icon, private val mode: Layout) :
        ToggleAction(text, text, icon), DumbAware {

        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun isSelected(e: AnActionEvent) = getLayout() == mode

        override fun setSelected(e: AnActionEvent, state: Boolean) {
            if (state) {
                layoutMode = mode
                setLayout(mode)
            }
        }
    }

    private inner class WrapAction :
        ToggleAction("Wrap", "Wrap the diagram to the window width", AllIcons.Actions.ToggleSoftWrap), DumbAware {

        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun isSelected(e: AnActionEvent) = wrapDiagram

        override fun setSelected(e: AnActionEvent, state: Boolean) {
            wrapDiagram = state
            PipelinePreview.refreshAll()
        }
    }
}
