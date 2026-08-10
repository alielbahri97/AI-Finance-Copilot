package com.ballastmoney.android.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider

/**
 * The root theme. Wrap the whole app in it, and every `@Preview` too.
 *
 * There is deliberately no Material You dynamic colour here. Ballast's #005ADB
 * is the product's identity — it is the manifest `theme_color`, it is what
 * `chartNet` means, and a balance that reads green-on-lavender because of
 * someone's wallpaper would undermine the one thing a finance app has to
 * project. Dynamic colour also cannot express the semantic pairs this design
 * system depends on (income vs expense, tinted vs solid destructive), so
 * enabling it would mean maintaining two palettes with different meanings.
 *
 * Window insets and the edge-to-edge flag are the host activity's business; this
 * function only provides colour, type and shape.
 */
@Composable
fun BallastTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) BallastDarkColorScheme else BallastLightColorScheme
    val extendedColors = if (darkTheme) BallastDarkExtendedColors else BallastLightExtendedColors

    CompositionLocalProvider(LocalBallastColors provides extendedColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = BallastTypography,
            shapes = BallastShapes,
            content = content,
        )
    }
}
