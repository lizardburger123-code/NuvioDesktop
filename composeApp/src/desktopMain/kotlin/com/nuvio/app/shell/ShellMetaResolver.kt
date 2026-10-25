package com.nuvio.app.shell

import com.nuvio.app.features.addons.AddonRepository
import com.nuvio.app.features.addons.enabledAddons
import com.nuvio.app.features.addons.supportsResource
import com.nuvio.app.features.catalog.fetchCatalogPage
import com.nuvio.app.features.home.MetaPreview
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Some catalogs list titles under ids no installed addon can describe (a TMDB-only id, an
 * addon's own id scheme). Search finds the same title under an id that works, so when the
 * details page can't load, look the title up by name the way Search does and use that id.
 */
internal object ShellMetaResolver {
    private fun normalize(value: String): String =
        value.lowercase().filter { it.isLetterOrDigit() }

    /** Returns (type, id) of the same title under an id some addon can describe, or null. */
    suspend fun resolve(type: String, id: String, name: String): Pair<String, String>? {
        val query = name.trim()
        val wanted = normalize(query)
        if (wanted.length < 2) return null
        val manifests = AddonRepository.uiState.value.addons.enabledAddons().mapNotNull { it.manifest }
        val describable = { itemType: String, itemId: String ->
            itemId != id && manifests.any { it.supportsResource("meta", itemType, itemId) }
        }
        val requests = manifests.flatMap { manifest ->
            manifest.catalogs
                .filter { catalog ->
                    catalog.extra.any { it.name == "search" } &&
                        catalog.extra.none { it.isRequired && it.name != "search" }
                }
                .map { manifest to it }
        }
        if (requests.isEmpty()) return null

        val items: List<MetaPreview> = coroutineScope {
            requests.map { (manifest, catalog) ->
                async {
                    withTimeoutOrNull(10_000) {
                        runCatching {
                            fetchCatalogPage(
                                manifestUrl = manifest.transportUrl,
                                type = catalog.type,
                                catalogId = catalog.id,
                                search = query,
                                maxItems = 25,
                            ).items
                        }.getOrNull()
                    }.orEmpty()
                }
            }.awaitAll().flatten()
        }

        val matches = items.filter { normalize(it.name) == wanted && describable(it.type, it.id) }
        val pick = matches.firstOrNull { it.type == type && it.id.startsWith("tt") }
            ?: matches.firstOrNull { it.type == type }
            ?: matches.firstOrNull()
        return pick?.let { it.type to it.id }
    }
}
