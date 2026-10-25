package com.nuvio.app.core.shell

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import com.nuvio.app.features.streams.StreamItem

/** What the desktop web shell asks the app to play. Mirrors the stream launch inputs. */
data class ShellPlaybackRequest(
    val type: String,
    val videoId: String,
    val parentMetaId: String,
    val parentMetaType: String,
    val title: String,
    val logo: String? = null,
    val poster: String? = null,
    val background: String? = null,
    val seasonNumber: Int? = null,
    val episodeNumber: Int? = null,
    val episodeTitle: String? = null,
    val episodeThumbnail: String? = null,
    val pauseDescription: String? = null,
    val resumePositionMs: Long? = null,
    val resumeProgressFraction: Float? = null,
    /** The source the user picked in the shell; null lets the app choose (auto-play, last link). */
    val preselectedStream: StreamItem? = null,
    val startFromBeginning: Boolean = false,
)

class AppShellActions(
    val launchPlayback: (ShellPlaybackRequest) -> Unit,
    /** Shows one of the classic tabs (and optionally a settings page) under the shell. */
    val openClassicTab: (tabName: String, settingsPageName: String?) -> Unit,
)

/**
 * Lets a platform replace the main tabs (Home, Search, Library, Settings) with its own UI.
 * Desktop Windows uses it for the WebView2 shell; everywhere else it is null and the classic
 * Compose tabs render as before.
 */
interface AppShellOverride {
    @Composable
    fun TabsContent(
        active: Boolean,
        actions: AppShellActions,
        classic: @Composable () -> Unit,
    )
}

val LocalAppShellOverride = staticCompositionLocalOf<AppShellOverride?> { null }
