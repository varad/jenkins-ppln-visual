package dev.jpv.intellij

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.Separator
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.TextEditorWithPreview
import com.intellij.openapi.fileEditor.impl.text.TextEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.jcef.JBCefApp
import javax.swing.Icon

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
        // The base class otherwise reopens every file in whichever mode was used last.
        setLayout(Layout.SHOW_EDITOR)
    }

    override fun isShowFloatingToolbar() = false

    override fun createViewActionGroup(): ActionGroup = DefaultActionGroup(
        ModeAction("Code", AllIcons.General.LayoutEditorOnly, Layout.SHOW_EDITOR),
        ModeAction("View", AllIcons.General.LayoutPreviewOnly, Layout.SHOW_PREVIEW),
        ModeAction("Dual", AllIcons.General.LayoutEditorPreview, Layout.SHOW_EDITOR_AND_PREVIEW),
        Separator.getInstance(),
        WrapAction(),
    )

    private inner class ModeAction(text: String, icon: Icon, private val mode: Layout) :
        ToggleAction(text, text, icon), DumbAware {

        override fun isSelected(e: AnActionEvent) = layout == mode

        override fun setSelected(e: AnActionEvent, state: Boolean) {
            if (state) layout = mode
        }
    }

    private inner class WrapAction :
        ToggleAction("Wrap", "Wrap the diagram to the window width", AllIcons.Actions.ToggleSoftWrap), DumbAware {

        override fun isSelected(e: AnActionEvent) = wrapDiagram

        override fun setSelected(e: AnActionEvent, state: Boolean) {
            wrapDiagram = state
            view.refresh()
        }
    }
}
