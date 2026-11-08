plugins {
    id("java")
    kotlin("jvm") version "2.4.21"
    id("org.jetbrains.intellij.platform") version "2.20.0"
}

group = "dev.jpv"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

kotlin {
    jvmToolchain(25)
}

dependencies {
    intellijPlatform {
        intellijIdea("2026.3")
        bundledPlugin("com.intellij.modules.jcef")
    }
}

intellijPlatform {
    // Skips the "no searchable options" IDE launch, which a viewer with no settings doesn't need.
    buildSearchableOptions = false

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

val repoRoot = rootDir.resolve("../..").normalize()
val webDir = repoRoot.resolve("packages/web")

val buildWebview by tasks.registering(Exec::class) {
    workingDir = repoRoot
    commandLine("pnpm", "--filter", "@jpv/web", "build:embed")
    inputs.dir(repoRoot.resolve("packages/core/src"))
    inputs.dir(webDir.resolve("src"))
    inputs.files(webDir.resolve("embed.html"), webDir.resolve("vite.config.ts"))
    outputs.file(webDir.resolve("dist-embed/embed.html"))
}

tasks.processResources {
    from(buildWebview) {
        into("webview")
    }
}
