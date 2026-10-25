package com.nuvio.app.features.autosync

import com.nuvio.app.core.storage.DesktopStorage
import com.nuvio.app.core.storage.ProfileScopedKey

/** Persists the AutoSync settings on desktop (Android uses SharedPreferences for the same keys). */
internal object DesktopAutoSyncPreferences {
    private const val PreferredSubtitleAutoSyncOnStartKey = "preferred_subtitle_auto_sync_on_start"
    private const val AggressiveModeKey = "auto_sync_aggressive_mode"
    private const val SyncToleranceMsKey = "auto_sync_tolerance_ms"

    private val store by lazy { DesktopStorage.store("nuvio_autosync_settings") }

    fun initialize() {
        AutoSyncPreferencesRepository.installPersistence(
            load = { store.getBoolean(ProfileScopedKey.of(PreferredSubtitleAutoSyncOnStartKey)) },
            save = { enabled -> store.putBoolean(ProfileScopedKey.of(PreferredSubtitleAutoSyncOnStartKey), enabled) },
            loadAggressiveMode = { store.getBoolean(ProfileScopedKey.of(AggressiveModeKey)) },
            saveAggressiveMode = { enabled -> store.putBoolean(ProfileScopedKey.of(AggressiveModeKey), enabled) },
            loadSyncToleranceMs = { store.getInt(ProfileScopedKey.of(SyncToleranceMsKey)) },
            saveSyncToleranceMs = { value -> store.putInt(ProfileScopedKey.of(SyncToleranceMsKey), value) },
        )
    }
}
