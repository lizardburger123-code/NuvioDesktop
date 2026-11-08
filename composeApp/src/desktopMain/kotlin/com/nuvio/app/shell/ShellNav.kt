package com.nuvio.app.shell

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Lets native screens (the player) steer the web interface: open a section or a title. */
object ShellNav {
    @Volatile var sink: ((topic: String, data: JsonElement) -> Unit)? = null

    fun open(name: String, params: JsonElement = buildJsonObject {}) {
        sink?.invoke("nav.open", buildJsonObject { put("name", name); put("params", params) })
    }

    fun openDetails(id: String, type: String, name: String = "") {
        open("details", buildJsonObject { put("id", id); put("type", type); if (name.isNotBlank()) put("name", name) })
    }
}
