plugins {
    // Downloads the JDK that kotlin.jvmToolchain asks for when it isn't installed.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "jenkinsfile-visualizer-intellij"
