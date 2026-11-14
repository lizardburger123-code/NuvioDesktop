package com.nuvio.app.shell

import com.nuvio.app.features.player.desktop.DesktopHostOs
import java.io.File
import java.lang.management.ManagementFactory

/**
 * Performance mode. "lite" drops the costly visuals and keeps less in memory, for modest
 * computers; "full" is the app as designed; "auto" (the default) picks lite on modest hardware.
 * NUVIO_PERFORMANCE=auto|lite|full overrides the saved choice, for testing and for scripts.
 *
 * The web interface resolves the same rule from the bootstrap's `device` and the appearance's
 * `performance`; the native parts (the Linux page helper, the player) ask [isLite].
 */
internal object ShellPerformance {
    val Choices = setOf("auto", "lite", "full")

    data class Hardware(
        /** "linux", "windows", "macos" or "unknown". */
        val os: String,
        val cores: Int,
        /** Installed memory, 0 when it couldn't be read. */
        val memoryMb: Long,
        /** Linux: the page helper draws without the graphics card. */
        val softwareRender: Boolean,
        /** Why "auto" picks lite on this computer, in plain words; empty when it doesn't. */
        val reason: String,
    ) {
        val lowEnd: Boolean get() = reason.isNotEmpty()
    }

    private val override: String? =
        System.getenv("NUVIO_PERFORMANCE")?.trim()?.lowercase()?.takeIf { it in Choices }

    @Volatile private var saved: String = "auto"

    val hardware: Hardware by lazy { detect() }

    /** Called with the saved appearance's choice when it loads and whenever it changes. */
    fun setSavedChoice(choice: String) {
        saved = choice.trim().lowercase().takeIf { it in Choices } ?: "auto"
    }

    /** The choice in force: the environment's override, else the saved one. */
    fun choice(): String = override ?: saved

    /** True when the environment fixes the choice, so Settings can't change it. */
    fun overridden(): Boolean = override != null

    fun isLite(): Boolean = when (choice()) {
        "lite" -> true
        "full" -> false
        else -> hardware.lowEnd
    }

    private fun detect(): Hardware {
        val host = DesktopHostOs.current
        val linux = host == DesktopHostOs.LINUX
        val cores = Runtime.getRuntime().availableProcessors()
        val memoryMb = totalMemoryMb(linux)
        val software = linux && runCatching { LinuxShellRender.mode() == "software" }.getOrDefault(false)
        val reason = when {
            memoryMb in 1L..4608L -> "${(memoryMb + 512) / 1024} GB of memory"
            cores <= 2 -> "$cores processor cores"
            linux && olderProcessor() -> "an older processor"
            software && cores <= 4 -> "drawing without the graphics card"
            else -> ""
        }
        return Hardware(
            os = host.name.lowercase(),
            cores = cores,
            memoryMb = memoryMb,
            softwareRender = software,
            reason = reason,
        )
    }

    private fun totalMemoryMb(linux: Boolean): Long {
        if (linux) {
            // "MemTotal:        3921232 kB"
            val kb = runCatching {
                File("/proc/meminfo").useLines { lines -> lines.firstOrNull { it.startsWith("MemTotal:") } }
                    ?.trim()?.split(Regex("\\s+"))?.getOrNull(1)?.toLongOrNull()
            }.getOrNull()
            if (kb != null && kb > 0L) return kb / 1024
        }
        @Suppress("DEPRECATION")
        val bytes = runCatching {
            (ManagementFactory.getOperatingSystemMXBean() as? com.sun.management.OperatingSystemMXBean)?.totalPhysicalMemorySize
        }.getOrNull() ?: 0L
        return if (bytes > 0L) bytes / (1024 * 1024) else 0L
    }

    /**
     * A processor from before 2013 (or a small low-power one) lacks AVX2. That's a fair sign the
     * full visuals will stutter, whatever the core count says.
     */
    private fun olderProcessor(): Boolean = runCatching {
        File("/proc/cpuinfo").useLines { lines ->
            val flags = lines.firstOrNull { it.startsWith("flags") } ?: return@useLines false
            !flags.split(Regex("\\s+")).contains("avx2")
        }
    }.getOrDefault(false)
}
