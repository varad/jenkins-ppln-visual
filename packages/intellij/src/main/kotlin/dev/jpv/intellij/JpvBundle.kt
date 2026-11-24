package dev.jpv.intellij

import com.intellij.DynamicBundle
import java.util.Locale
import java.util.ResourceBundle

/** The plugin's texts, in the same language as the diagram. */
object JpvBundle {
    /**
     * The IDE's language when a language pack sets one, else the operating system's: language packs exist only for a few
     * languages, so an English IDE on, say, a French system still gets a French diagram.
     */
    val locale: Locale by lazy {
        val ide = DynamicBundle.getLocale()
        val chosen = if (ide.language != Locale.ENGLISH.language) ide else Locale.getDefault()
        // The Chinese texts are Simplified (JpvBundle_zh_CN), like the IDE's own Chinese language pack.
        if (chosen.language == "zh" && chosen.country.isEmpty() && chosen.script.isEmpty()) Locale.SIMPLIFIED_CHINESE else chosen
    }

    private val bundle: ResourceBundle by lazy {
        ResourceBundle.getBundle(
            "messages.JpvBundle",
            locale,
            JpvBundle::class.java.classLoader,
            ResourceBundle.Control.getNoFallbackControl(ResourceBundle.Control.FORMAT_PROPERTIES),
        )
    }

    fun message(key: String): String = bundle.getString(key)
}
