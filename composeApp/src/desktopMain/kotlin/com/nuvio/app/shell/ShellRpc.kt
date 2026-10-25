package com.nuvio.app.shell

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import co.touchlab.kermit.Logger
import com.nuvio.app.core.build.AppVersionConfig
import com.nuvio.app.core.shell.AppShellActions
import com.nuvio.app.core.shell.ShellPlaybackRequest
import com.nuvio.app.features.addons.AddAddonResult
import com.nuvio.app.features.addons.AddonRepository
import com.nuvio.app.features.addons.enabledAddons
import com.nuvio.app.features.autosync.AutoSyncPreferencesRepository
import com.nuvio.app.features.details.MetaDetailsRepository
import com.nuvio.app.features.home.HomeRepository
import com.nuvio.app.features.library.LibraryRepository
import com.nuvio.app.features.player.PlayerSettingsRepository
import com.nuvio.app.features.player.desktop.DesktopSubtitleLayout
import com.nuvio.app.features.player.desktop.DesktopSubtitleLayoutStorage
import com.nuvio.app.features.profiles.ProfileRepository
import com.nuvio.app.features.search.SearchHistoryRepository
import com.nuvio.app.features.search.SearchRepository
import com.nuvio.app.features.streams.StreamAutoPlayMode
import com.nuvio.app.features.streams.StreamItem
import com.nuvio.app.features.streams.StreamLinkCacheRepository
import com.nuvio.app.features.streams.StreamsRepository
import com.nuvio.app.features.watched.WatchedRepository
import com.nuvio.app.features.watchprogress.WatchProgressRepository
import com.nuvio.app.shell.ShellJson.bool
import com.nuvio.app.shell.ShellJson.double
import com.nuvio.app.shell.ShellJson.int
import com.nuvio.app.shell.ShellJson.long
import com.nuvio.app.shell.ShellJson.string
import com.nuvio.app.shell.ShellJson.asStringList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** What the RPC needs from the window that hosts the shell. */
internal interface ShellHost {
    fun post(json: String)
    fun actions(): AppShellActions?
    fun openClassic(tabName: String, settingsPage: String?)
    fun setClassicInterface(enabled: Boolean)
    fun toggleFullscreen()
    fun openUrl(url: String)
}

/**
 * Answers the page's requests from the app's repositories and pushes their state as topics.
 * Requests run on the Swing main thread, like the Compose screens that used these repositories.
 */
internal class ShellRpc(private val host: ShellHost) {
    private val log = Logger.withTag("ShellRpc")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val topicJobs = mutableMapOf<String, Job>()
    private val json = Json { ignoreUnknownKeys = true }

    @Volatile private var detailsKey: Pair<String, String>? = null
    @Volatile private var streamsVideoId: String? = null
    @Volatile private var searchQuery: String = ""
    @Volatile private var streamIndex: Map<String, StreamItem> = emptyMap()

    fun handle(raw: String) {
        val message = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return
        val event = message.string("event")
        if (event != null) {
            onNativeEvent(event, message)
            return
        }
        val id = message.long("id") ?: 0L
        val method = message.string("method") ?: return
        val params = (message["params"] as? JsonObject) ?: JsonObject(emptyMap())
        scope.launch {
            val result = runCatching { dispatch(method, params) }
            if (id == 0L) return@launch
            val reply = result.fold(
                onSuccess = { value -> buildJsonObject { put("id", id); put("result", value) } },
                onFailure = { error ->
                    log.w(error) { "shell request failed: $method" }
                    buildJsonObject { put("id", id); put("error", error.message ?: error::class.simpleName ?: "Request failed") }
                },
            )
            host.post(reply.toString())
        }
    }

    fun push(topic: String, data: JsonElement) {
        host.post(buildJsonObject { put("topic", topic); put("data", data) }.toString())
    }

    private fun onNativeEvent(event: String, message: JsonObject) {
        when (event) {
            "toggleFullscreen" -> host.toggleFullscreen()
            "failed" -> log.e { "shell webview failed: ${message.string("reason")}" }
            else -> log.d { "shell event $event" }
        }
    }

    private fun <T> watch(topic: String, flow: Flow<T>, map: (T) -> JsonElement) {
        if (topicJobs[topic]?.isActive == true) return
        topicJobs[topic] = scope.launch {
            flow.distinctUntilChanged().conflate().collect { value ->
                val data = withContext(Dispatchers.Default) { runCatching { map(value) }.getOrElse { JsonNull } }
                push(topic, data)
            }
        }
    }

    private suspend fun dispatch(method: String, params: JsonObject): JsonElement = when (method) {
        "app.bootstrap" -> bootstrap()
        "app.log" -> {
            log.w { "page: ${params.string("message")} ${params.string("source").orEmpty()}" }
            JsonPrimitive(true)
        }
        "app.openUrl" -> {
            val url = params.string("url").orEmpty()
            require(url.startsWith("https://") || url.startsWith("http://")) { "Only web links can be opened." }
            host.openUrl(url)
            JsonPrimitive(true)
        }
        "app.openTrailer" -> {
            val key = (params["trailer"] as? JsonObject)?.string("key").orEmpty()
            require(key.isNotBlank()) { "No trailer link." }
            host.openUrl("https://www.youtube.com/watch?v=$key")
            JsonPrimitive(true)
        }
        "app.useClassic" -> {
            host.setClassicInterface(params.bool("enabled") != false)
            JsonPrimitive(true)
        }
        "legacy.open" -> {
            val page = when (params.string("page")) {
                "playback" -> "Playback"
                "subtitles" -> "Playback"
                "addons" -> "Addons"
                else -> null
            }
            host.openClassic("Settings", page)
            JsonPrimitive(true)
        }
        "home.subscribe" -> subscribeHome()
        "home.refresh" -> {
            HomeRepository.refresh(AddonRepository.uiState.value.addons.enabledAddons(), force = true)
            JsonPrimitive(true)
        }
        "search.history" -> {
            SearchHistoryRepository.ensureLoaded()
            ShellJson.strings(SearchHistoryRepository.uiState.value.take(8))
        }
        "search.query" -> search(params)
        "details.load" -> loadDetails(params)
        "streams.load" -> loadStreams(params)
        "play" -> play(params)
        "play.resume" -> resume(params)
        "watchLater.toggle" -> {
            val item = params["item"] as? JsonObject ?: error("Missing item.")
            val added = WatchLaterStore.toggle(
                WatchLaterItem(
                    id = item.string("id") ?: error("Missing id."),
                    type = item.string("type") ?: "movie",
                    name = item.string("name").orEmpty(),
                    poster = item.string("poster"),
                    banner = item.string("banner"),
                    logo = item.string("logo"),
                    releaseInfo = item.string("releaseInfo"),
                    imdbRating = item.string("imdbRating"),
                    genres = item["genres"].asStringList(),
                ),
            )
            JsonPrimitive(added)
        }
        "library.subscribe" -> subscribeLibrary()
        "continue.remove" -> {
            val id = params.string("id") ?: error("Missing title.")
            WatchProgressRepository.removeProgress(contentId = id)
            JsonPrimitive(true)
        }
        "settings.appearance.get" -> appearanceJson()
        "settings.appearance.set" -> setAppearance(params)
        "settings.subtitles.get" -> subtitlesJson()
        "settings.subtitles.set" -> setSubtitles(params)
        "settings.playback.get" -> playbackJson()
        "settings.playback.set" -> setPlayback(params)
        "subtitles.testProvider" -> SubtitleSearchService.test(params.string("provider").orEmpty())
        "addons.list" -> addonsJson()
        "addons.install" -> {
            val url = params.string("url").orEmpty().trim()
            require(url.isNotBlank()) { "Paste a manifest link first." }
            when (val result = AddonRepository.addAddon(url)) {
                is AddAddonResult.Success -> buildJsonObject { put("ok", true); put("name", result.manifest.name) }
                is AddAddonResult.Error -> error(result.message)
            }
        }
        "addons.remove" -> {
            AddonRepository.removeAddon(params.string("id") ?: error("Missing addon."))
            JsonPrimitive(true)
        }
        "addons.configure" -> {
            val manifestUrl = params.string("id") ?: error("Missing addon.")
            host.openUrl(manifestUrl.replace("/manifest.json", "/configure"))
            JsonPrimitive(true)
        }
        "profiles.switch" -> {
            val target = params.int("id") ?: error("Missing profile.")
            val profile = ProfileRepository.state.value.profiles.firstOrNull { it.profileIndex == target }
            require(profile?.pinEnabled != true) { "That profile has a PIN. Switch to it from the classic profile picker." }
            ProfileRepository.switchToProfile(target)
            JsonPrimitive(true)
        }
        else -> error("Unknown request $method")
    }

    // ---- App -------------------------------------------------------------------------------

    private suspend fun bootstrap(): JsonElement {
        // A (re)loaded page has an empty topic cache: restart every subscription so it gets current values.
        topicJobs.values.forEach { it.cancel() }
        topicJobs.clear()
        val state = ProfileRepository.state.value
        val activeIndex = ProfileRepository.activeProfileId
        val active = state.activeProfile ?: state.profiles.firstOrNull { it.profileIndex == activeIndex }
        WatchLaterStore.ensureLoaded()
        val avatar = active?.let { profile ->
            kotlinx.coroutines.withTimeoutOrNull(4_000) {
                runCatching {
                    val repo = com.nuvio.app.features.profiles.AvatarRepository
                    if (repo.avatars.value.isEmpty() && profile.avatarId != null) repo.fetchAvatars()
                    val item = profile.avatarId?.let { id -> repo.avatars.value.firstOrNull { it.id == id } }
                    com.nuvio.app.features.profiles.profileAvatarImageUrl(profile, item)
                        ?.takeIf { it.startsWith("http") || it.startsWith("data:") }
                        ?: item?.localImageUrl?.let { local -> if (local.startsWith("/") || local.matches(Regex("^[A-Za-z]:.*"))) java.io.File(local).toURI().toString() else local }
                }.getOrNull()
            }
        }
        return buildJsonObject {
            put("profile", buildJsonObject {
                put("id", active?.profileIndex ?: activeIndex)
                put("name", active?.name?.ifBlank { null } ?: "You")
                avatar?.let { put("avatar", it) }
                active?.avatarColorHex?.let { put("color", it) }
            })
            put("profiles", buildJsonArray {
                state.profiles.forEach { profile ->
                    add(buildJsonObject {
                        put("id", profile.profileIndex)
                        put("name", profile.name)
                        put("pin", profile.pinEnabled)
                        put("color", profile.avatarColorHex)
                        val item = profile.avatarId?.let { id -> com.nuvio.app.features.profiles.AvatarRepository.avatars.value.firstOrNull { it.id == id } }
                        val url = if (profile.profileIndex == active?.profileIndex) avatar
                            else runCatching { com.nuvio.app.features.profiles.profileAvatarImageUrl(profile, item) }.getOrNull()?.takeIf { it.startsWith("http") }
                        url?.let { put("avatar", it) }
                    })
                }
            })
            put("version", AppVersionConfig.DESKTOP_VERSION_NAME)
            put("appearance", appearanceJson())
            put("native", true)
        }
    }

    // ---- Home ------------------------------------------------------------------------------

    private fun subscribeHome(): JsonElement {
        AddonRepository.initialize()
        WatchProgressRepository.ensureLoaded()
        WatchedRepository.ensureLoaded()
        WatchLaterStore.ensureLoaded()
        watch("home", HomeRepository.uiState) { state ->
            buildJsonObject {
                put("loading", state.isLoading)
                put("hero", buildJsonArray { state.heroItems.forEach { add(ShellJson.preview(it)) } })
                put("sections", buildJsonArray { state.sections.forEach { add(ShellJson.section(it)) } })
                state.errorMessage?.let { put("error", it) }
            }
        }
        watch("continue", WatchProgressRepository.uiState) { state ->
            val entries = state.entries
                .filter { !it.isCompleted && it.parentMetaId !in state.hiddenContentIds && it.lastPositionMs > 0 }
                .groupBy { it.parentMetaId }
                .map { (_, entries) -> entries.maxBy { it.lastUpdatedEpochMs } }
                .sortedByDescending { it.lastUpdatedEpochMs }
                .take(24)
            buildJsonArray { entries.forEach { add(ShellJson.continueEntry(it)) } }
        }
        watch("watchLater", WatchLaterStore.items) { items -> watchLaterJson(items) }
        subscribeLibrary()
        return JsonPrimitive(true)
    }

    private fun watchLaterJson(items: List<WatchLaterItem>): JsonArray = buildJsonArray {
        items.forEach { item ->
            add(buildJsonObject {
                put("id", item.id)
                put("type", item.type)
                put("name", item.name)
                item.poster?.let { put("poster", it) }
                item.banner?.let { put("banner", it) }
                item.logo?.let { put("logo", it) }
                item.releaseInfo?.let { put("releaseInfo", it) }
                item.imdbRating?.let { put("imdbRating", it) }
                put("genres", ShellJson.strings(item.genres))
                put("addedAt", item.addedAt)
            })
        }
    }

    private fun subscribeLibrary(): JsonElement {
        LibraryRepository.ensureLoaded()
        watch("library", combine(LibraryRepository.uiState, HomeRepository.uiState) { library, home -> library to home }) { (library, home) ->
            val cloud = home.sections
                .filter { section -> section.title.contains("library", ignoreCase = true) || section.key.contains("library", ignoreCase = true) }
                .flatMap { it.items }
                .distinctBy { "${it.type}:${it.id}" }
            buildJsonObject {
                put("items", buildJsonArray { library.items.forEach { add(ShellJson.libraryItem(it)) } })
                put("cloud", buildJsonArray { cloud.forEach { add(ShellJson.preview(it)) } })
            }
        }
        if (topicJobs["watchLater"]?.isActive != true) watch("watchLater", WatchLaterStore.items) { watchLaterJson(it) }
        return JsonPrimitive(true)
    }

    // ---- Search ----------------------------------------------------------------------------

    private fun search(params: JsonObject): JsonElement {
        val query = params.string("query").orEmpty().trim()
        searchQuery = query
        if (params.bool("commit") == true && query.length > 1) SearchHistoryRepository.recordSearch(query)
        watch("search", SearchRepository.uiState) { state ->
            buildJsonObject {
                put("query", searchQuery)
                put("loading", state.isLoading)
                put("sections", buildJsonArray {
                    state.sections.forEach { section ->
                        add(buildJsonObject {
                            put("key", section.key)
                            put("title", section.title)
                            put("type", section.target.contentType)
                            put("addonName", section.addonName)
                            put("items", buildJsonArray { section.items.forEach { add(ShellJson.preview(it)) } })
                        })
                    }
                })
                state.errorMessage?.let { put("error", it) }
            }
        }
        SearchRepository.search(query, AddonRepository.uiState.value.addons)
        return JsonPrimitive(true)
    }

    // ---- Details ---------------------------------------------------------------------------

    private fun loadDetails(params: JsonObject): JsonElement {
        val type = params.string("type") ?: error("Missing type.")
        val id = params.string("id") ?: error("Missing id.")
        detailsKey = type to id
        WatchProgressRepository.ensureLoaded()
        WatchedRepository.ensureLoaded()
        watch(
            "details",
            combine(MetaDetailsRepository.uiState, WatchProgressRepository.uiState, WatchLaterStore.items) { meta, progress, later -> Triple(meta, progress, later) },
        ) { (state, progress, later) ->
            val (wantedType, wantedId) = detailsKey ?: ("" to "")
            val meta = state.meta?.takeIf { it.id == wantedId }
            buildJsonObject {
                put("key", "$wantedType:$wantedId")
                put("loading", meta == null && state.errorMessage == null)
                state.errorMessage?.takeIf { meta == null }?.let { put("error", it) }
                put("watchLater", later.any { it.id == wantedId })
                if (meta == null) {
                    put("meta", JsonNull)
                } else {
                    val forContent = progress.byVideoIdForContent(meta.id)
                    val resume = forContent.values
                        .filter { !it.isCompleted && it.lastPositionMs > 0 }
                        .maxByOrNull { it.lastUpdatedEpochMs }
                    put("meta", ShellJson.details(
                        meta = meta,
                        progressFor = { video -> forContent[video.id] },
                        watchedFor = { video -> runCatching { WatchedRepository.isWatched(meta.id, meta.type, video.season, video.episode) }.getOrDefault(false) },
                        resume = resume,
                    ))
                }
            }
        }
        MetaDetailsRepository.load(type, id)
        return JsonPrimitive(true)
    }

    // ---- Streams and playback ---------------------------------------------------------------

    private fun loadStreams(params: JsonObject): JsonElement {
        val type = params.string("type") ?: error("Missing type.")
        val videoId = params.string("videoId") ?: error("Missing video.")
        streamsVideoId = videoId
        watch("streams", StreamsRepository.uiState) { state ->
            val index = mutableMapOf<String, StreamItem>()
            state.groups.forEach { group -> group.streams.forEachIndexed { i, stream -> index[ShellJson.streamKey(group.addonId, i, stream)] = stream } }
            streamIndex = index
            buildJsonObject {
                put("key", streamsVideoId)
                put("loading", state.isAnyLoading)
                put("groups", buildJsonArray { state.groups.forEach { add(ShellJson.streamGroup(it)) } })
                state.emptyStateReason?.let { put("empty", it.name) }
            }
        }
        StreamsRepository.load(
            type = type,
            videoId = videoId,
            parentMetaId = params.string("parentMetaId"),
            season = params.int("season"),
            episode = params.int("episode"),
            manualSelection = true,
        )
        return JsonPrimitive(true)
    }

    private fun request(params: JsonObject, stream: StreamItem?): ShellPlaybackRequest {
        val type = params.string("type") ?: error("Missing type.")
        val metaId = params.string("metaId") ?: params.string("id") ?: error("Missing title.")
        val videoId = params.string("videoId") ?: metaId
        val season = params.int("season")
        val episode = params.int("episode")
        val saved = WatchProgressRepository.progressForVideo(videoId, metaId, season, episode)?.takeIf { it.isResumable }
        val meta = MetaDetailsRepository.peek(params.string("metaType") ?: type, metaId)
        return ShellPlaybackRequest(
            type = type,
            videoId = videoId,
            parentMetaId = metaId,
            parentMetaType = params.string("metaType") ?: type,
            title = params.string("title") ?: meta?.name ?: saved?.title ?: "",
            logo = params.string("logo") ?: meta?.logo ?: saved?.logo,
            poster = params.string("poster") ?: meta?.poster ?: saved?.poster,
            background = params.string("background") ?: meta?.background ?: saved?.background,
            seasonNumber = season,
            episodeNumber = episode,
            episodeTitle = params.string("episodeTitle") ?: saved?.episodeTitle,
            episodeThumbnail = params.string("thumbnail") ?: saved?.episodeThumbnail,
            pauseDescription = params.string("description") ?: meta?.description,
            resumePositionMs = saved?.lastPositionMs,
            resumeProgressFraction = saved?.takeIf { it.durationMs > 0 }?.let { (it.lastPositionMs.toDouble() / it.durationMs).toFloat() },
            preselectedStream = stream,
        )
    }

    private fun play(params: JsonObject): JsonElement {
        val actions = host.actions() ?: error("Playback isn't ready yet. Try again in a moment.")
        val key = params.string("streamKey") ?: error("Missing source.")
        val stream = streamIndex[key] ?: error("That source is no longer listed. Reload the sources and pick again.")
        actions.launchPlayback(request(params, stream))
        return buildJsonObject { put("ok", true) }
    }

    /** Continue watching: restart the last source instantly when it is still cached. */
    private suspend fun resume(params: JsonObject): JsonElement {
        val type = params.string("type") ?: error("Missing type.")
        val id = params.string("id") ?: error("Missing title.")
        var videoId = params.string("videoId") ?: id
        var season = params.int("season")
        var episode = params.int("episode")
        if (params.bool("nextEpisode") == true) {
            val meta = MetaDetailsRepository.fetch(type, id)
            val videos = meta?.videos.orEmpty().filter { (it.season ?: 0) > 0 }
                .sortedWith(compareBy({ it.season ?: 0 }, { it.episode ?: 0 }))
            val index = videos.indexOfFirst { it.id == videoId || (it.season == season && it.episode == episode) }
            val next = videos.getOrNull(index + 1) ?: error("That was the last episode.")
            videoId = next.id
            season = next.season
            episode = next.episode
            return buildJsonObject {
                put("handled", false)
                put("videoId", videoId)
                season?.let { put("season", it) }
                episode?.let { put("episode", it) }
            }
        }
        val settings = PlayerSettingsRepository.uiState.value
        if (!settings.streamReuseLastLinkEnabled) return buildJsonObject { put("handled", false) }
        val cacheKey = StreamLinkCacheRepository.contentKey(type = type, videoId = videoId, parentMetaId = id, season = season, episode = episode)
        val cached = StreamLinkCacheRepository.getValid(cacheKey, settings.streamReuseLastLinkCacheHours * 3_600_000L)
            ?: return buildJsonObject { put("handled", false) }
        val actions = host.actions() ?: return buildJsonObject { put("handled", false) }
        val withIds = buildJsonObject {
            params.forEach { (k, v) -> put(k, v) }
            put("metaId", id)
            put("videoId", videoId)
        }
        actions.launchPlayback(request(withIds, null))
        log.d { "resume reused ${cached.addonName}" }
        return buildJsonObject { put("handled", true) }
    }

    // ---- Settings ------------------------------------------------------------------------

    private fun appearanceJson(): JsonObject {
        val value = ShellAppearanceStore.load()
        return buildJsonObject {
            put("colors", ShellJson.strings(value.colors))
            put("wallpaper", buildJsonObject {
                put("mode", value.wallpaperMode)
                ShellAppearanceStore.wallpaperDataUrl()?.let { put("image", it) } ?: put("image", JsonNull)
            })
            put("dim", value.dim)
            put("blur", value.blur)
            put("animate", value.animate)
        }
    }

    private fun setAppearance(params: JsonObject): JsonElement {
        var value = ShellAppearanceStore.load()
        params["colors"]?.asStringList()?.takeIf { it.size == 3 && it.all { c -> c.matches(Regex("#[0-9a-fA-F]{6}")) } }?.let { value = value.copy(colors = it) }
        params.double("dim")?.let { value = value.copy(dim = it.coerceIn(0.0, 0.9)) }
        params.double("blur")?.let { value = value.copy(blur = it.coerceIn(0.0, 40.0)) }
        params.bool("animate")?.let { value = value.copy(animate = it) }
        (params["wallpaper"] as? JsonObject)?.let { wallpaper ->
            wallpaper.string("mode")?.takeIf { it in setOf("featured", "custom", "none") }?.let { value = value.copy(wallpaperMode = it) }
            if (wallpaper.containsKey("image")) {
                val image = wallpaper.string("image")
                if (image == null) ShellAppearanceStore.saveWallpaper(null)
                else if (image.startsWith("data:image/")) ShellAppearanceStore.saveWallpaper(image)
            }
        }
        ShellAppearanceStore.save(value)
        return JsonPrimitive(true)
    }

    private fun Color.hex(): String = "#%06X".format(toArgb() and 0xFFFFFF)
    private fun parseColor(hex: String?): Color? = hex?.removePrefix("#")?.takeIf { it.length == 6 }
        ?.toLongOrNull(16)?.let { Color(0xFF000000 or it) }

    private fun subtitlesJson(): JsonObject {
        PlayerSettingsRepository.ensureLoaded()
        AutoSyncPreferencesRepository.ensureLoaded()
        val style = PlayerSettingsRepository.uiState.value.subtitleStyle
        val prefs = ShellSubtitleStore.prefs.value
        return buildJsonObject {
            put("font", prefs.font)
            put("size", style.fontSizeSp)
            put("bold", style.bold)
            put("outline", style.outlineEnabled)
            put("color", style.textColor.hex())
            put("outlineColor", style.outlineColor.hex())
            put("align", DesktopSubtitleLayoutStorage.load().align)
            put("splitLines", prefs.splitLines)
            put("autoSync", AutoSyncPreferencesRepository.preferredSubtitleAutoSyncOnStart.value)
            put("languages", ShellJson.strings(prefs.languages))
            put("providers", buildJsonObject {
                put("opensubtitles", buildJsonObject {
                    put("apiKey", prefs.keys.opensubtitlesApiKey)
                    put("username", prefs.keys.opensubtitlesUsername)
                    put("password", prefs.keys.opensubtitlesPassword)
                })
                put("subdl", buildJsonObject { put("apiKey", prefs.keys.subdlApiKey) })
                put("subsource", buildJsonObject { put("apiKey", prefs.keys.subsourceApiKey) })
            })
        }
    }

    private fun setSubtitles(params: JsonObject): JsonElement {
        PlayerSettingsRepository.ensureLoaded()
        var style = PlayerSettingsRepository.uiState.value.subtitleStyle
        val before = style
        params.int("size")?.let { style = style.copy(fontSizeSp = it.coerceIn(8, 48)) }
        params.bool("bold")?.let { style = style.copy(bold = it) }
        params.bool("outline")?.let { style = style.copy(outlineEnabled = it) }
        parseColor(params.string("color"))?.let { style = style.copy(textColor = it) }
        parseColor(params.string("outlineColor"))?.let { style = style.copy(outlineColor = it) }
        if (style != before) PlayerSettingsRepository.setSubtitleStyle(style)
        params.string("align")?.let { align ->
            if (align in setOf(DesktopSubtitleLayout.ALIGN_CENTER, DesktopSubtitleLayout.ALIGN_LEFT, DesktopSubtitleLayout.ALIGN_RIGHT)) {
                DesktopSubtitleLayoutStorage.saveAlign(align)
            }
        }
        params.bool("autoSync")?.let { AutoSyncPreferencesRepository.setPreferredSubtitleAutoSyncOnStart(it) }
        ShellSubtitleStore.update { prefs ->
            var next = prefs
            params.string("font")?.takeIf { it.isNotBlank() && it.length < 64 }?.let { next = next.copy(font = it) }
            params.bool("splitLines")?.let { next = next.copy(splitLines = it) }
            (params["languages"] as? JsonArray)?.let { next = next.copy(languages = params["languages"].asStringList().take(6)) }
            (params["providers"] as? JsonObject)?.let { providers ->
                val os = providers["opensubtitles"] as? JsonObject
                val subdl = providers["subdl"] as? JsonObject
                val subsource = providers["subsource"] as? JsonObject
                next = next.copy(
                    keys = next.keys.copy(
                        opensubtitlesApiKey = os?.string("apiKey") ?: next.keys.opensubtitlesApiKey,
                        opensubtitlesUsername = os?.string("username") ?: next.keys.opensubtitlesUsername,
                        opensubtitlesPassword = os?.string("password") ?: next.keys.opensubtitlesPassword,
                        subdlApiKey = subdl?.string("apiKey") ?: next.keys.subdlApiKey,
                        subsourceApiKey = subsource?.string("apiKey") ?: next.keys.subsourceApiKey,
                    ),
                )
            }
            next
        }
        return JsonPrimitive(true)
    }

    private fun playbackJson(): JsonArray {
        PlayerSettingsRepository.ensureLoaded()
        val s = PlayerSettingsRepository.uiState.value
        fun toggle(key: String, label: String, description: String?, value: Boolean) = buildJsonObject {
            put("key", key)
            put("label", label)
            description?.let { put("description", it) }
            put("type", "toggle")
            put("value", value)
        }
        return buildJsonArray {
            add(toggle("autoplay", "Play the first source automatically", "Skips the source list and starts the top result from your addons.", s.streamAutoPlayMode != StreamAutoPlayMode.MANUAL))
            add(toggle("reuseLastLink", "Reuse the last source", "Continue watching restarts the same file instantly while the link is still fresh.", s.streamReuseLastLinkEnabled))
            add(toggle("nextEpisode", "Play the next episode automatically", null, s.streamAutoPlayNextEpisodeEnabled))
            add(toggle("skipIntro", "Show skip intro", null, s.skipIntroEnabled))
            add(toggle("pauseOverlay", "Show details when paused", null, s.pauseOverlayEnabled))
        }
    }

    private fun setPlayback(params: JsonObject): JsonElement {
        val value = params.bool("value") ?: error("Missing value.")
        when (params.string("key")) {
            "autoplay" -> PlayerSettingsRepository.setStreamAutoPlayMode(if (value) StreamAutoPlayMode.FIRST_STREAM else StreamAutoPlayMode.MANUAL)
            "reuseLastLink" -> PlayerSettingsRepository.setStreamReuseLastLinkEnabled(value)
            "nextEpisode" -> PlayerSettingsRepository.setStreamAutoPlayNextEpisodeEnabled(value)
            "skipIntro" -> PlayerSettingsRepository.setSkipIntroEnabled(value)
            "pauseOverlay" -> PlayerSettingsRepository.setPauseOverlayEnabled(value)
            else -> error("Unknown setting.")
        }
        return JsonPrimitive(true)
    }

    private fun addonsJson(): JsonArray = buildJsonArray {
        AddonRepository.uiState.value.addons.forEach { addon ->
            add(buildJsonObject {
                put("id", addon.manifestUrl)
                put("name", addon.displayTitle)
                put("description", addon.manifest?.description.orEmpty())
                put("version", addon.manifest?.version.orEmpty())
                addon.manifest?.logoUrl?.let { put("logo", it) }
                put("types", ShellJson.strings(addon.manifest?.types.orEmpty()))
                put("configurable", addon.manifest?.behaviorHints?.configurable == true)
                put("enabled", addon.enabled)
                addon.errorMessage?.let { put("error", it) }
            })
        }
    }

    fun dispose() {
        topicJobs.values.forEach { it.cancel() }
        topicJobs.clear()
    }
}
