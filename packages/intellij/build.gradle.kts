import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.aware.SplitModeAware

plugins {
    id("java")
    kotlin("jvm") version "2.4.21"
    id("org.jetbrains.intellij.platform")
}

group = "dev.jpv"
version = "0.2.0"

kotlin {
    jvmToolchain(25)
}

subprojects {
    apply(plugin = "org.jetbrains.kotlin.jvm")
    apply(plugin = "org.jetbrains.intellij.platform.module")

    extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
        jvmToolchain(25)
    }

    // The IDE finds a content module's descriptor in lib/modules/<module name>.jar, so the JAR is named after the module.
    tasks.named<org.jetbrains.intellij.platform.gradle.tasks.ComposedJarTask>("composedJar") {
        archiveFileName = "dev.jpv.jenkinsfile.${project.name}.jar"
    }
}

dependencies {
    intellijPlatform {
        // Only here: the content modules get the IDE from the root project.
        intellijIdea("2026.3")
        bundledPlugin("com.intellij.modules.jcef")
        bundledPlugin("org.intellij.groovy")
        pluginModule(implementation(project(":frontend")))
        pluginModule(implementation(project(":groovy")))
        testFramework(TestFrameworkType.Platform)
    }
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.opentest4j:opentest4j:1.3.0")
}

intellijPlatform {
    // Skips the "no searchable options" IDE launch, which a viewer with no settings doesn't need.
    buildSearchableOptions = false

    // runIdeSplitMode starts a backend plus a JetBrains Client, like Remote Development. The editor runs on the client,
    // the Groovy mapping on the backend, so the plugin goes into both sandboxes.
    pluginInstallationTarget = SplitModeAware.PluginInstallationTarget.BOTH

    pluginConfiguration {
        ideaVersion {
            sinceBuild = "263"
            untilBuild = "263.*"
        }
    }

    pluginVerification {
        ides {
            recommended()
        }
    }
}
