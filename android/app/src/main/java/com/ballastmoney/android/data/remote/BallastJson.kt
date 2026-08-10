package com.ballastmoney.android.data.remote

import kotlinx.serialization.json.Json

/**
 * The single JSON configuration, shared by the HTTP client and by type-safe
 * navigation.
 *
 * [ignoreUnknownKeys] matters more than it looks: the API ships from the same
 * repository but not necessarily at the same moment as the app, and an installed
 * client must not crash because the server started returning a new field.
 * [explicitNulls] is off so an absent field and an explicit null are treated the
 * same, which is what the web API does.
 */
val BallastJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    isLenient = false
}
