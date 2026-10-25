package com.nuvio.app.shell

import co.touchlab.kermit.Logger
import com.nuvio.app.features.player.AddonSubtitle
import com.nuvio.app.features.player.PersistedPlayerTrackPreference
import com.nuvio.app.features.player.PersistedSubtitleSelectionType
import com.nuvio.app.features.player.PlayerTrackPreferenceStorage
import com.nuvio.app.features.player.addonSubtitleRequests
import com.nuvio.app.features.player.loadAddonSubtitles
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * The "which subtitles?" window shown after picking a source: subtitles from the user's addons and
 * search sites, ranked by how well each release fits the file about to play. The choice is saved
 * the same way the player saves one, so the player loads it at start and Continue watching
 * brings it (and its delay) back.
 */
internal object ShellSubtitlePicker {
    private val log = Logger.withTag("SubtitlePicker")

    /** What a choice applies to: one movie, or one episode of a series. */
    data class Target(val parentMetaId: String, val videoId: String, val season: Int?, val episode: Int?) {
        /** Same shape as the player's subtitle preference item id. */
        val itemId: String get() = "$videoId|${season ?: -1}|${episode ?: -1}"
    }

    private sealed interface Candidate {
        val language: String
        data class Site(val result: SubtitleResult) : Candidate { override val language: String get() = result.language }
        data class Addon(val subtitle: AddonSubtitle, override val language: String) : Candidate
    }

    private val candidates = ConcurrentHashMap<String, Candidate>()

    private val languageNames = mapOf(
        "ar" to "Arabic", "en" to "English", "fr" to "French", "tr" to "Turkish", "es" to "Spanish", "de" to "German",
        "fa" to "Persian", "ur" to "Urdu", "it" to "Italian", "pt" to "Portuguese", "ru" to "Russian", "nl" to "Dutch",
    )

    private fun languageName(code: String): String =
        languageNames[code] ?: Locale.forLanguageTag(code).getDisplayLanguage(Locale.ENGLISH).ifBlank { code.uppercase(Locale.ROOT) }

    /**
     * Searches everything at once and returns a ranked list. [query] replaces the title (a custom
     * search); [filename] is the file about to play and drives the ranking.
     */
    suspend fun match(
        type: String,
        target: Target,
        title: String,
        year: Int?,
        filename: String?,
        query: String?,
        languages: List<String>?,
    ): JsonElement {
        val prefs = ShellSubtitleStore.prefs.value
        val wanted = (languages?.takeIf { it.isNotEmpty() } ?: prefs.languages).ifEmpty { listOf("ar", "en") }
        val custom = query?.trim()?.takeIf { it.length > 1 }
        val siteQuery = SubtitleQuery(
            title = custom ?: title,
            imdbId = target.parentMetaId.takeIf { custom == null && it.startsWith("tt") },
            year = year.takeIf { custom == null },
            season = target.season,
            episode = target.episode,
            releaseHint = filename,
            languages = wanted,
        )
        val file = SubtitleReleaseMatch.parse(filename)
        val (sites, addons) = coroutineScope {
            val siteJob = async { withTimeoutOrNull(22_000) { runCatching { SubtitleSearchService.search(siteQuery) }.getOrNull() }.orEmpty() }
            val addonJob = async {
                if (custom != null) emptyList<AddonSubtitle>()
                else withTimeoutOrNull(12_000) { runCatching { loadAddonSubtitles(addonSubtitleRequests(type, target.videoId)) }.getOrNull() }.orEmpty()
            }
            siteJob.await() to addonJob.await()
        }

        data class Row(val key: String, val candidate: Candidate, val source: String, val release: String, val downloads: Long, val hi: Boolean, val match: Double, val score: Double)
        val rows = mutableListOf<Row>()
        sites.forEach { result ->
            rows += Row("s:${result.provider}:${result.id}", Candidate.Site(result), result.providerName, result.release, result.downloads, result.hearingImpaired, result.match, result.score)
        }
        addons.forEachIndexed { index, subtitle ->
            val language = SubtitleSearchService.normalizeLanguage(subtitle.language)
            if (language !in wanted) return@forEachIndexed
            val release = subtitle.display.takeIf { it.isNotBlank() && !it.equals(subtitle.language, true) } ?: subtitle.id
            val match = if (filename.isNullOrBlank()) 0.0 else SubtitleReleaseMatch.score(file, release, target.season, target.episode)
            val asResult = SubtitleResult(provider = "addon", providerName = subtitle.addonName ?: "Addon", id = subtitle.id, language = language, release = release)
            rows += Row("a:$index:${subtitle.url.hashCode()}", Candidate.Addon(subtitle, language), subtitle.addonName ?: "Addon", release, 0, false, match,
                SubtitleSearchService.rank(asResult, wanted, match) + 0.5)
        }
        val ranked = rows.sortedByDescending { it.score }.distinctBy { "${it.source}|${it.release}|${it.candidate.language}" }.take(120)
        candidates.clear()
        ranked.forEach { candidates[it.key] = it.candidate }
        val bestKey = ranked.firstOrNull()?.key

        return buildJsonObject {
            filename?.let { put("filename", it) }
            put("configured", SubtitleSearchService.configuredSources())
            put("languages", buildJsonArray {
                wanted.forEach { code -> add(buildJsonObject { put("code", code); put("name", languageName(code)) }) }
            })
            put("results", buildJsonArray {
                ranked.forEach { row ->
                    add(buildJsonObject {
                        put("key", row.key)
                        put("source", row.source)
                        put("addon", row.candidate is Candidate.Addon)
                        put("language", row.candidate.language)
                        put("languageName", languageName(row.candidate.language))
                        put("release", row.release)
                        if (row.downloads > 0) put("downloads", row.downloads)
                        if (row.hi) put("hi", true)
                        put("match", (row.match * 100).toInt())
                        SubtitleReleaseMatch.label(row.match)?.let { put("matchLabel", it) }
                        if (row.key == bestKey) put("best", true)
                    })
                }
            })
        }
    }

    /**
     * Applies a choice for [target]: a key from the last [match], "none" (no subtitles) or null
     * (leave it to the player). Site subtitles are downloaded first.
     */
    suspend fun choose(key: String?, target: Target) {
        when (key) {
            null, "", "auto" -> return
            "none" -> {
                val current = PlayerTrackPreferenceStorage.load(target.parentMetaId) ?: PersistedPlayerTrackPreference()
                PlayerTrackPreferenceStorage.save(
                    target.parentMetaId,
                    current.copy(
                        subtitleType = PersistedSubtitleSelectionType.DISABLED,
                        subtitleLanguage = null, subtitleName = null, subtitleTrackId = null,
                        addonSubtitleId = null, addonSubtitleUrl = null, addonSubtitleItemId = null, addonSubtitleAddonName = null,
                    ),
                )
            }
            else -> when (val candidate = candidates[key] ?: error("That subtitle is no longer listed. Search again.")) {
                is Candidate.Site -> {
                    val path = SubtitleSearchService.download(candidate.result)
                    remember(target, path.toString(), candidate.result.language, candidate.result.release, candidate.result.providerName)
                }
                is Candidate.Addon -> remember(
                    target, candidate.subtitle.url, candidate.language, candidate.subtitle.display,
                    candidate.subtitle.addonName, id = candidate.subtitle.id,
                )
            }
        }
    }

    /** Saves [url] (a link or a local file) as the subtitle for [target], like a pick in the player. */
    fun remember(target: Target, url: String, language: String?, name: String?, provider: String?, id: String? = null) {
        if (target.parentMetaId.isBlank()) return
        val current = PlayerTrackPreferenceStorage.load(target.parentMetaId) ?: PersistedPlayerTrackPreference()
        PlayerTrackPreferenceStorage.save(
            target.parentMetaId,
            current.copy(
                subtitleType = PersistedSubtitleSelectionType.ADDON,
                subtitleLanguage = language,
                subtitleName = name,
                subtitleTrackId = null,
                subtitleIsForced = null,
                addonSubtitleId = id ?: url,
                addonSubtitleUrl = url,
                addonSubtitleItemId = target.itemId,
                addonSubtitleAddonName = provider,
            ),
        )
        log.d { "remembered subtitle for ${target.itemId} from $provider" }
    }
}
