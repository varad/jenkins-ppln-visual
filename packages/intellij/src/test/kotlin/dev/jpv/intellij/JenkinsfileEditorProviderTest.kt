package dev.jpv.intellij

import com.intellij.ide.highlighter.ArchiveFileType
import com.intellij.openapi.application.WriteAction
import com.intellij.openapi.fileTypes.ExactFileNameMatcher
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class JenkinsfileEditorProviderTest : BasePlatformTestCase() {
    private val provider = JenkinsfileEditorProvider()

    private fun canOpen(path: String) =
        provider.canOpen(project, myFixture.addFileToProject(path, "pipeline {}").virtualFile)

    fun testAcceptsJenkinsfileNames() {
        assertTrue(canOpen("Jenkinsfile"))
        assertTrue(canOpen("ci/deploy.Jenkinsfile"))
        assertTrue(canOpen("ci/Jenkinsfile.prod"))
    }

    fun testRejectsOtherFiles() {
        assertFalse(canOpen("build.gradle"))
        val dir = myFixture.addFileToProject("Jenkinsfile.d/x.txt", "").virtualFile.parent
        assertFalse(provider.canOpen(project, dir))
    }

    /**
     * A Jenkinsfile mapped to a binary type has no document. It used to be accepted, which hid the
     * default editor and crashed in createEditor.
     */
    fun testRejectsBinaryJenkinsfile() = withFileType("Jenkinsfile", ArchiveFileType.INSTANCE) {
        val file = myFixture.addFileToProject("Jenkinsfile", "pipeline {}").virtualFile
        assertTrue(file.fileType.isBinary)
        assertFalse(provider.canOpen(project, file))
    }

    private fun withFileType(name: String, type: FileType, body: () -> Unit) {
        val matcher = ExactFileNameMatcher(name)
        WriteAction.runAndWait<Throwable> { FileTypeManager.getInstance().associate(type, matcher) }
        try {
            body()
        } finally {
            WriteAction.runAndWait<Throwable> { FileTypeManager.getInstance().removeAssociation(type, matcher) }
        }
    }
}
