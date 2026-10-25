package com.nuvio.app.shell

import com.nuvio.app.core.storage.DesktopStorage
import com.nuvio.app.features.profiles.AvatarCatalogItem
import com.nuvio.app.features.profiles.AvatarRepository
import com.nuvio.app.features.profiles.NuvioProfile
import com.nuvio.app.features.profiles.ProfileRepository
import com.nuvio.app.features.profiles.avatarImageUrl
import com.nuvio.app.features.profiles.normalizedAvatarUrl
import com.nuvio.app.features.profiles.profileAvatarImageUrl
import com.nuvio.app.features.watchprogress.WatchProgressRepository
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.Base64

/** Profile pictures and the numbers on the profile card. */
internal object ShellProfiles {
    private fun uploadFile(profileIndex: Int) = DesktopStorage.rootDir.resolve("shell-avatar-$profileIndex.jpg")

    /**
     * Pictures in the catalog can be member-only files cached on disk. The page can't load file
     * URLs from its own origin, so a local picture goes in as a data URL.
     */
    private fun pageUrl(value: String?): String? {
        val url = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return when {
            url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:") -> url
            url.startsWith("file:") -> runCatching { dataUrl(File(java.net.URI(url))) }.getOrNull()
            url.startsWith("/") || Regex("^[A-Za-z]:[\\\\/].*").matches(url) -> dataUrl(File(url))
            else -> null
        }
    }

    private fun dataUrl(file: File): String? = runCatching {
        if (!file.isFile || file.length() > 3L * 1024 * 1024) return null
        val mime = when (file.extension.lowercase()) {
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "svg" -> "image/svg+xml"
            else -> "image/jpeg"
        }
        "data:$mime;base64," + Base64.getEncoder().encodeToString(file.readBytes())
    }.getOrNull()

    private suspend fun ensureCatalog() {
        if (AvatarRepository.avatars.value.isNotEmpty()) return
        withTimeoutOrNull(4_000) { runCatching { AvatarRepository.fetchAvatars() } }
    }

    private fun localUpload(profileIndex: Int): String? = runCatching {
        val file = uploadFile(profileIndex)
        if (!Files.exists(file)) return null
        "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(Files.readAllBytes(file))
    }.getOrNull()

    suspend fun avatarFor(profile: NuvioProfile): String? {
        localUpload(profile.profileIndex)?.let { return it }
        if (profile.avatarId != null) ensureCatalog()
        val item = profile.avatarId?.let { id -> AvatarRepository.avatars.value.firstOrNull { it.id == id } }
        return pageUrl(profileAvatarImageUrl(profile, item)) ?: pageUrl(item?.localImageUrl)
    }

    suspend fun catalog(): JsonElement {
        ensureCatalog()
        return buildJsonArray {
            AvatarRepository.avatars.value.filter { it.isActive }.sortedBy { it.sortOrder }.forEach { item: AvatarCatalogItem ->
                val url = pageUrl(avatarImageUrl(item)) ?: return@forEach
                add(buildJsonObject {
                    put("id", item.id)
                    put("name", item.displayName)
                    put("url", url)
                    put("category", item.category)
                    item.bgColor?.let { put("color", it) }
                    put("member", item.memberOnly)
                })
            }
        }
    }

    private fun active(): NuvioProfile {
        val state = ProfileRepository.state.value
        return state.activeProfile
            ?: state.profiles.firstOrNull { it.profileIndex == ProfileRepository.activeProfileId }
            ?: error("No profile is active.")
    }

    /**
     * Change the active profile's picture:
     *  - avatarId: a picture from Nuvio's catalog (synced to every device),
     *  - url: an image link (synced, like the classic profile editor),
     *  - upload: a picture from this PC (kept on this PC only).
     */
    suspend fun setAvatar(avatarId: String?, url: String?, upload: String?): JsonElement {
        val profile = active()
        val file = uploadFile(profile.profileIndex)
        when {
            upload != null -> {
                val base64 = upload.substringAfter("base64,", "")
                require(base64.isNotBlank()) { "That picture couldn't be read." }
                val bytes = Base64.getDecoder().decode(base64)
                require(bytes.size < 4 * 1024 * 1024) { "That picture is too large." }
                Files.createDirectories(file.parent)
                Files.write(file, bytes)
            }
            avatarId != null -> {
                ensureCatalog()
                val item = AvatarRepository.avatars.value.firstOrNull { it.id == avatarId } ?: error("That picture isn't available.")
                runCatching { Files.deleteIfExists(file) }
                ProfileRepository.updateProfile(
                    profileIndex = profile.profileIndex,
                    name = profile.name,
                    avatarColorHex = item.bgColor ?: profile.avatarColorHex,
                    avatarId = item.id,
                    avatarUrl = null,
                    profileBackgroundId = profile.profileBackgroundId,
                    profileBackgroundUrl = profile.profileBackgroundUrl,
                    usesPrimaryAddons = profile.usesPrimaryAddons,
                )
            }
            url != null -> {
                val link = normalizedAvatarUrl(url) ?: error("Use a full https:// image link.")
                runCatching { Files.deleteIfExists(file) }
                ProfileRepository.updateProfile(
                    profileIndex = profile.profileIndex,
                    name = profile.name,
                    avatarColorHex = profile.avatarColorHex,
                    avatarId = null,
                    avatarUrl = link,
                    profileBackgroundId = profile.profileBackgroundId,
                    profileBackgroundUrl = profile.profileBackgroundUrl,
                    usesPrimaryAddons = profile.usesPrimaryAddons,
                )
            }
            else -> error("Pick a picture first.")
        }
        val updated = runCatching { active() }.getOrDefault(profile)
        return buildJsonObject {
            avatarFor(updated)?.let { put("avatar", it) }
            put("color", updated.avatarColorHex)
            put("local", upload != null)
        }
    }

    /**
     * What the profile card shows. Minutes are estimated from saved progress (a finished title
     * counts its full length on the day it was finished), so the week view is approximate.
     */
    fun stats(): JsonElement {
        WatchProgressRepository.ensureLoaded()
        val entries = WatchProgressRepository.uiState.value.entries
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val minutes = IntArray(7)
        var finishedThisMonth = 0
        entries.forEach { entry ->
            val day = Instant.ofEpochMilli(entry.lastUpdatedEpochMs).atZone(zone).toLocalDate()
            val back = ChronoUnit.DAYS.between(day, today)
            if (entry.isCompleted && day.year == today.year && day.month == today.month) finishedThisMonth += 1
            if (back in 0..6) {
                val watchedMs = if (entry.isCompleted) entry.durationMs else entry.lastPositionMs
                minutes[(6 - back).toInt()] += (watchedMs.coerceAtLeast(0) / 60_000).toInt().coerceAtMost(600)
            }
        }
        val inProgress = entries.filter { !it.isCompleted && it.lastPositionMs > 0 }.map { it.parentMetaId }.distinct().size
        var streak = 0
        for (i in 6 downTo 0) {
            if (minutes[i] > 0) streak += 1 else if (i < 6) break
        }
        return buildJsonObject {
            put("inProgress", inProgress)
            put("finishedThisMonth", finishedThisMonth)
            put("weekMinutes", minutes.sum())
            put("streak", streak)
            put("days", buildJsonArray {
                for (i in 0..6) {
                    val date = today.minusDays((6 - i).toLong())
                    add(buildJsonObject {
                        put("label", date.dayOfWeek.getDisplayName(java.time.format.TextStyle.NARROW, java.util.Locale.getDefault()))
                        put("minutes", minutes[i])
                        put("today", i == 6)
                    })
                }
            })
        }
    }
}
