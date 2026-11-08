import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    id("java")
    kotlin("jvm") version "1.8.22"
    id("org.jetbrains.intellij") version "1.13.3"
}

group = "dev.jpv"
version = "0.1.0"

repositories {
    mavenCentral()
}

java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
}

tasks.withType<KotlinCompile> {
    kotlinOptions {
        jvmTarget = "11"
        apiVersion = "1.6" // the Kotlin runtime bundled with IntelliJ 2022.1
        languageVersion = "1.6"
    }
}

intellij {
    version.set("2022.1.4")
    type.set("IC")
}

tasks.patchPluginXml {
    sinceBuild.set("221")
    untilBuild.set("221.*")
}

// Skips the "no searchable options" IDE launch, which a viewer with no settings doesn't need.
tasks.buildSearchableOptions {
    enabled = false
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
