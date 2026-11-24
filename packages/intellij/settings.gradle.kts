import org.jetbrains.intellij.platform.gradle.extensions.intellijPlatform

plugins {
    // Downloads the JDK that kotlin.jvmToolchain asks for when it isn't installed.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
    // Also puts the IntelliJ Platform Gradle plugin on the classpath, so build files apply it without a version.
    id("org.jetbrains.intellij.platform.settings") version "2.20.0"
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
        intellijPlatform {
            defaultRepositories()
        }
    }
}

rootProject.name = "jenkinsfile-visualizer-intellij"

// Content modules. The editor runs where the UI is (the client in split mode); the Groovy mapping where Groovy is.
include("frontend", "groovy")
