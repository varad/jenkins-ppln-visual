import org.jetbrains.intellij.platform.gradle.TestFrameworkType

dependencies {
    intellijPlatform {
        bundledModule("intellij.platform.frontend")
        bundledPlugin("com.intellij.modules.jcef")
        testFramework(TestFrameworkType.Platform)
    }
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.opentest4j:opentest4j:1.3.0")
}

val repoRoot = rootDir.resolve("../..").normalize()
val webDir = repoRoot.resolve("packages/web")

val buildWebview = tasks.register<Exec>("buildWebview") {
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
