package com.ballastmoney.android.ui.chart

import androidx.compose.ui.graphics.Color

/**
 * Slate 400, the colour the web app paints uncategorised spending in. Anything
 * that cannot be parsed lands here too, so a bad hex in the database shows up as
 * "uncategorised grey" rather than as a crash or an invisible slice.
 */
const val UNCATEGORIZED_COLOR_HEX: String = "#94A3B8"

val UncategorizedColor: Color = Color(0xFF94A3B8)

/**
 * Parses a category colour.
 *
 * Category colours come from user-editable database rows, so this has to cope
 * with anything: a missing value, a missing `#`, the three-digit shorthand, an
 * eight-digit value with alpha, and outright junk. Every failure path returns
 * [UncategorizedColor] instead of throwing — a chart is not worth crashing a
 * screen for.
 */
fun parseHexColor(hex: String?, fallback: Color = UncategorizedColor): Color {
    val cleaned = hex?.trim()?.removePrefix("#")?.takeIf { it.isNotEmpty() } ?: return fallback
    val expanded = when (cleaned.length) {
        // `#abc` is shorthand for `#aabbcc`.
        3 -> cleaned.map { "$it$it" }.joinToString(separator = "")
        6, 8 -> cleaned
        else -> return fallback
    }
    val value = expanded.toLongOrNull(radix = 16) ?: return fallback
    return if (expanded.length == 8) {
        // Already AARRGGBB.
        Color(value)
    } else {
        Color(value or OPAQUE_ALPHA)
    }
}

private const val OPAQUE_ALPHA = 0xFF000000L
