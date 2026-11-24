package dev.jpv.intellij

import com.intellij.openapi.fileEditor.ex.FileEditorProviderManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/** Loads the whole plugin, so it catches content modules that the IDE skips or wires up wrongly. */
class PluginDescriptorTest : BasePlatformTestCase() {

    fun testEditorModuleRegistersTheProvider() {
        // Looked up by id: listing the providers for a file runs accept, which needs JCEF, and tests run headless.
        assertNotNull(FileEditorProviderManager.getInstance().getProvider("jenkinsfile-visualizer"))
    }

    fun testGroovyModuleMapsJenkinsfileNames() {
        for (name in listOf("Jenkinsfile", "ci/deploy.Jenkinsfile", "ci/Jenkinsfile.prod")) {
            val file = myFixture.addFileToProject(name, "pipeline {}").virtualFile
            assertEquals(name, "Groovy", file.fileType.name)
        }
    }
}
