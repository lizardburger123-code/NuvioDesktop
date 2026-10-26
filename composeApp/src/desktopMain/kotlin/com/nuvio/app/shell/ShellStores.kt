package com.nuvio.app.shell

import com.nuvio.app.core.storage.DesktopStorage
import com.nuvio.app.core.storage.ProfileScopedKey
import com.nuvio.app.features.profiles.ProfileRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.util.Base64

private val storeJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

/** Titles saved to watch later, newest first. One list per profile. */
@Serializable
internal data class WatchLaterItem(
    val id: String,
    val type: String,
    val name: String,
    val poster: String? = null,
    val banner: String? = null,
    val logo: String? = null,
    val releaseInfo: String? = null,
    val imdbRating: String? = null,
    val genres: List<String> = emptyList(),
    val addedAt: Long = 0L,
)

internal object WatchLaterStore {
    private const val Key = "watch_later_items"
    private val store by lazy { DesktopStorage.store("nuvio_watch_later") }
    private val serializer = ListSerializer(WatchLaterItem.serializer())
    private var loadedProfile: Int = -1
    private val _items = MutableStateFlow<List<WatchLaterItem>>(emptyList())
    val items: StateFlow<List<WatchLaterItem>> = _items.asStateFlow()

    @Synchronized
    fun ensureLoaded() {
        val profile = ProfileRepository.activeProfileId
        if (profile == loadedProfile) return
        loadedProfile = profile
        _items.value = store.getString(ProfileScopedKey.of(Key, profile))
            ?.let { runCatching { storeJson.decodeFromString(serializer, it) }.getOrNull() }
            .orEmpty()
    }

    @Synchronized
    fun toggle(item: WatchLaterItem): Boolean {
        ensureLoaded()
        val current = _items.value
        val exists = current.any { it.id == item.id && it.type == item.type }
        val next = if (exists) current.filterNot { it.id == item.id && it.type == item.type }
        else listOf(item.copy(addedAt = System.currentTimeMillis())) + current
        _items.value = next
        store.putString(ProfileScopedKey.of(Key, loadedProfile), storeJson.encodeToString(serializer, next))
        return !exists
    }

    fun contains(type: String, id: String): Boolean {
        ensureLoaded()
        return _items.value.any { it.id == id && it.type == type }
    }
}

@Serializable
internal data class ShellAppearance(
    val colors: List<String> = listOf("#1d2b64", "#6b3fa0", "#e0607e"),
    val wallpaperMode: String = "featured",
    val dim: Double = 0.35,
    val blur: Double = 0.0,
    val animate: Boolean = true,
    /** Title pages show their artwork sharp unless the user wants the wallpaper blur there too. */
    val blurArt: Boolean = false,
    /** "Who's watching?" after the intro. */
    val profileGate: Boolean = true,
    /** Home dashboard tiles the user hid (spotlight, resume, later, library). */
    val hiddenTiles: List<String> = emptyList(),
)

/** Colours, wallpaper and motion of the shell. The custom wallpaper is a JPEG next to the prefs. */
internal object ShellAppearanceStore {
    private const val Key = "appearance"
    private val store by lazy { DesktopStorage.store("nuvio_shell") }
    private val wallpaperFile by lazy { DesktopStorage.rootDir.resolve("shell-wallpaper.jpg") }

    fun load(): ShellAppearance =
        store.getString(Key)?.let { runCatching { storeJson.decodeFromString(ShellAppearance.serializer(), it) }.getOrNull() }
            ?: ShellAppearance()

    fun save(value: ShellAppearance) {
        store.putString(Key, storeJson.encodeToString(ShellAppearance.serializer(), value))
    }

    fun wallpaperDataUrl(): String? = runCatching {
        if (!Files.exists(wallpaperFile)) return null
        "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(Files.readAllBytes(wallpaperFile))
    }.getOrNull()

    /** Accepts the page's resized JPEG data URL; null removes the picture. */
    fun saveWallpaper(dataUrl: String?) {
        if (dataUrl == null) {
            runCatching { Files.deleteIfExists(wallpaperFile) }
            return
        }
        val base64 = dataUrl.substringAfter("base64,", missingDelimiterValue = "")
        require(base64.isNotBlank()) { "That image couldn't be read." }
        val bytes = Base64.getDecoder().decode(base64)
        require(bytes.size < 12 * 1024 * 1024) { "That image is too large." }
        Files.createDirectories(wallpaperFile.parent)
        Files.write(wallpaperFile, bytes)
    }

    fun classicInterface(): Boolean = store.getBoolean("use_classic_interface") == true
    fun setClassicInterface(enabled: Boolean) = store.putBoolean("use_classic_interface", enabled)
}

@Serializable
internal data class SubtitleProviderKeys(
    val opensubtitlesApiKey: String = "",
    val opensubtitlesUsername: String = "",
    val opensubtitlesPassword: String = "",
    val subdlApiKey: String = "",
    val subsourceApiKey: String = "",
)

@Serializable
internal data class ShellSubtitlePrefs(
    val font: String = "Cairo",
    val splitLines: Boolean = true,
    val languages: List<String> = listOf("ar", "en"),
    val keys: SubtitleProviderKeys = SubtitleProviderKeys(),
    /** Show the "which subtitles?" window after picking a source. */
    val askBeforePlay: Boolean = true,
)

/** Subtitle choices that the classic settings don't have: font, line splitting, search sources. */
internal object ShellSubtitleStore {
    private const val Key = "subtitle_prefs"
    private val store by lazy { DesktopStorage.store("nuvio_shell") }
    private val _prefs = MutableStateFlow(load())
    val prefs: StateFlow<ShellSubtitlePrefs> = _prefs.asStateFlow()

    private fun load(): ShellSubtitlePrefs =
        store.getString(Key)?.let { runCatching { storeJson.decodeFromString(ShellSubtitlePrefs.serializer(), it) }.getOrNull() }
            ?: ShellSubtitlePrefs()

    @Synchronized
    fun update(transform: (ShellSubtitlePrefs) -> ShellSubtitlePrefs): ShellSubtitlePrefs {
        val next = transform(_prefs.value)
        _prefs.value = next
        store.putString(Key, storeJson.encodeToString(ShellSubtitlePrefs.serializer(), next))
        return next
    }
}
