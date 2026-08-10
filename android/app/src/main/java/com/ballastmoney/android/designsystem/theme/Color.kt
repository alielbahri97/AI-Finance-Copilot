package com.ballastmoney.android.designsystem.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/*
 * The web app authors its palette in `oklch()` in `src/app/globals.css`. Android
 * has no oklch literal, so every token below is the sRGB conversion of the web
 * value. The conversion was validated against a known pair: the primary,
 * `oklch(0.5 0.22 255)`, resolves to #005ADB, which is exactly the `theme_color`
 * the web manifest declares.
 *
 * Names match the CSS custom properties one-for-one so the two palettes can be
 * diffed by eye. Do not "tidy" a value here without changing globals.css.
 */

// --- Light -----------------------------------------------------------------

private val LightBackground = Color(0xFFF8FAFD)
private val LightForeground = Color(0xFF050A12)
private val LightCard = Color(0xFFFFFFFF)
private val LightCardForeground = Color(0xFF050A12)
private val LightPopover = Color(0xFFFFFFFF)
private val LightPopoverForeground = Color(0xFF050A12)
private val LightPrimary = Color(0xFF005ADB)
private val LightPrimaryForeground = Color(0xFFF9FAFB)
private val LightSecondary = Color(0xFFF0F4F9)
private val LightSecondaryForeground = Color(0xFF111B28)
private val LightMuted = Color(0xFFECF1F5)
private val LightMutedForeground = Color(0xFF5F6A77)
private val LightAccent = Color(0xFFE4F0FF)
private val LightAccentForeground = Color(0xFF0045B0)
private val LightDestructive = Color(0xFFE7000B)
private val LightDestructiveForeground = Color(0xFFF9FAFB)
private val LightBorder = Color(0xFFE0E5EB)
private val LightInput = Color(0xFFE0E5EB)
private val LightRing = Color(0xFF005ADB)
private val LightChart1 = Color(0xFF005ADB)
private val LightChart2 = Color(0xFF008D5B)
private val LightChart3 = Color(0xFFCC6600)
private val LightChart4 = Color(0xFF953AE3)
private val LightChart5 = Color(0xFFDE1C4A)
private val LightSidebar = Color(0xFFFFFFFF)
private val LightSidebarAccent = Color(0xFFE4F0FF)
private val LightSidebarAccentForeground = Color(0xFF0045B0)
private val LightSidebarBorder = Color(0xFFE0E5EB)
private val LightSuccess = Color(0xFF007A28)
private val LightWarning = Color(0xFFA35303)
private val LightWarningForeground = Color(0xFFFFFFFF)
private val LightDestructiveTinted = Color(0xFFC80614)
private val LightSuccessTinted = Color(0xFF117534)
private val LightWarningTinted = Color(0xFF9E5106)
private val LightDestructiveSolid = Color(0xFFD20716)
private val LightChartProjected = Color(0xFF8F40D7)

// --- Dark ------------------------------------------------------------------

private val DarkBackground = Color(0xFF030507)
private val DarkForeground = Color(0xFFF6F9FB)
private val DarkCard = Color(0xFF0A0E12)
private val DarkCardForeground = Color(0xFFF6F9FB)
private val DarkPopover = Color(0xFF0A0E12)
private val DarkPopoverForeground = Color(0xFFF6F9FB)
private val DarkPrimary = Color(0xFF0074E3)
private val DarkPrimaryForeground = Color(0xFFF9FAFB)
private val DarkSecondary = Color(0xFF141B24)
private val DarkSecondaryForeground = Color(0xFFF6F9FB)
private val DarkMuted = Color(0xFF141B24)
private val DarkMutedForeground = Color(0xFF9CA5B1)
private val DarkAccent = Color(0xFF12253C)
private val DarkAccentForeground = Color(0xFFAED4FF)
private val DarkDestructive = Color(0xFFFF6467)
private val DarkDestructiveForeground = Color(0xFFF9FAFB)
private val DarkRing = Color(0xFF0074E3)
private val DarkChart1 = Color(0xFF0074E3)
private val DarkChart2 = Color(0xFF00BC7D)
private val DarkChart3 = Color(0xFFFE9A00)
private val DarkChart4 = Color(0xFFBD84FF)
private val DarkChart5 = Color(0xFFFF2056)
private val DarkSidebar = Color(0xFF05070B)
private val DarkSidebarAccent = Color(0xFF12253C)
private val DarkSidebarAccentForeground = Color(0xFFAED4FF)
private val DarkSuccess = Color(0xFF00C950)
private val DarkWarning = Color(0xFFF0B100)
private val DarkWarningForeground = Color(0xFF101828)
private val DarkDestructiveSolid = Color(0xFFD20716)
private val DarkChartProjected = Color(0xFFB471FA)

/**
 * Dark borders are a wash rather than a colour on the web
 * (`--border: oklch(1 0 0 / 12%)`), so they stay correct over both `card` and
 * `background`.
 */
private val DarkBorder = Color.White.copy(alpha = 0.12f)
private val DarkInput = Color.White.copy(alpha = 0.12f)
private val DarkSidebarBorder = Color.White.copy(alpha = 0.08f)

/**
 * Cards draw `border-border/60`. Tailwind's `/60` multiplies into whatever alpha
 * the token already has, so in dark that is 12% × 60% ≈ 7.2%, not 60%.
 */
private val LightCardBorder = LightBorder.copy(alpha = 0.60f)
private val DarkCardBorder = Color.White.copy(alpha = 0.072f)

/**
 * The Ballast tokens that Material 3's [androidx.compose.material3.ColorScheme]
 * has no slot for.
 *
 * Money products need more semantic colour than Material models: a scheme has
 * one `error` and no notion of "money came in". The `*Tinted` variants are the
 * same hues darkened enough to stay legible when printed on a 10% wash of
 * themselves, which is how badges and alerts are built on the web.
 */
@Immutable
data class BallastExtendedColors(
    val success: Color,
    val successTinted: Color,
    val warning: Color,
    val warningTinted: Color,
    val warningForeground: Color,
    val destructiveTinted: Color,
    val destructiveSolid: Color,
    val mutedForeground: Color,
    val accentForeground: Color,
    /** Hairline used by cards: the border token at 60%. */
    val cardBorder: Color,
    val sidebar: Color,
    val sidebarAccent: Color,
    val sidebarAccentForeground: Color,
    val sidebarBorder: Color,
    /** Semantic aliases so charts never pick a hue by hand. */
    val chartIncome: Color,
    val chartExpense: Color,
    val chartNet: Color,
    val chartProjected: Color,
    val chart1: Color,
    val chart2: Color,
    val chart3: Color,
    val chart4: Color,
    val chart5: Color,
) {
    /** The five categorical chart hues in web order. */
    val chartSeries: List<Color> get() = listOf(chart1, chart2, chart3, chart4, chart5)
}

internal val BallastLightExtendedColors = BallastExtendedColors(
    success = LightSuccess,
    successTinted = LightSuccessTinted,
    warning = LightWarning,
    warningTinted = LightWarningTinted,
    warningForeground = LightWarningForeground,
    destructiveTinted = LightDestructiveTinted,
    destructiveSolid = LightDestructiveSolid,
    mutedForeground = LightMutedForeground,
    accentForeground = LightAccentForeground,
    cardBorder = LightCardBorder,
    sidebar = LightSidebar,
    sidebarAccent = LightSidebarAccent,
    sidebarAccentForeground = LightSidebarAccentForeground,
    sidebarBorder = LightSidebarBorder,
    chartIncome = LightSuccess,
    chartExpense = LightDestructive,
    chartNet = LightPrimary,
    chartProjected = LightChartProjected,
    chart1 = LightChart1,
    chart2 = LightChart2,
    chart3 = LightChart3,
    chart4 = LightChart4,
    chart5 = LightChart5,
)

internal val BallastDarkExtendedColors = BallastExtendedColors(
    success = DarkSuccess,
    // In dark the web drops the darkened variants: the base hues already sit
    // brightly enough on a wash of themselves.
    successTinted = DarkSuccess,
    warning = DarkWarning,
    warningTinted = DarkWarning,
    warningForeground = DarkWarningForeground,
    destructiveTinted = DarkDestructive,
    destructiveSolid = DarkDestructiveSolid,
    mutedForeground = DarkMutedForeground,
    accentForeground = DarkAccentForeground,
    cardBorder = DarkCardBorder,
    sidebar = DarkSidebar,
    sidebarAccent = DarkSidebarAccent,
    sidebarAccentForeground = DarkSidebarAccentForeground,
    sidebarBorder = DarkSidebarBorder,
    chartIncome = DarkSuccess,
    chartExpense = DarkDestructive,
    chartNet = DarkPrimary,
    chartProjected = DarkChartProjected,
    chart1 = DarkChart1,
    chart2 = DarkChart2,
    chart3 = DarkChart3,
    chart4 = DarkChart4,
    chart5 = DarkChart5,
)

/*
 * Mapping notes, since Material's vocabulary and the web's do not line up:
 *
 *   primary/onPrimary            <- primary / primary-foreground
 *   primaryContainer             <- accent / accent-foreground (the blue wash)
 *   secondary/onSecondary        <- secondary / secondary-foreground
 *   background/onBackground      <- background / foreground
 *   surface/onSurface            <- card / card-foreground, because every
 *                                   Material component that says "surface"
 *                                   (menus, sheets, dialogs) is a popover on the
 *                                   web, and popover == card in both themes
 *   surfaceVariant/onSurfaceVariant <- muted / muted-foreground
 *   outline                      <- border;  outlineVariant <- border at 60%
 *   error/onError                <- destructive / destructive-foreground
 *   surfaceTint                  <- primary, but every Ballast surface is drawn
 *                                   at tonalElevation 0 so no tint is applied
 *
 * `ring` is primary in both themes, so focus rings can just use
 * `colorScheme.primary`; there is no separate slot to fill.
 */

internal val BallastLightColorScheme = lightColorScheme(
    primary = LightPrimary,
    onPrimary = LightPrimaryForeground,
    primaryContainer = LightAccent,
    onPrimaryContainer = LightAccentForeground,
    inversePrimary = DarkPrimary,
    secondary = LightSecondary,
    onSecondary = LightSecondaryForeground,
    secondaryContainer = LightSecondary,
    onSecondaryContainer = LightSecondaryForeground,
    tertiary = LightAccent,
    onTertiary = LightAccentForeground,
    tertiaryContainer = LightAccent,
    onTertiaryContainer = LightAccentForeground,
    background = LightBackground,
    onBackground = LightForeground,
    surface = LightCard,
    onSurface = LightCardForeground,
    surfaceVariant = LightMuted,
    onSurfaceVariant = LightMutedForeground,
    surfaceTint = LightPrimary,
    inverseSurface = DarkCard,
    inverseOnSurface = DarkCardForeground,
    error = LightDestructive,
    onError = LightDestructiveForeground,
    errorContainer = LightDestructive.copy(alpha = 0.10f),
    onErrorContainer = LightDestructiveTinted,
    outline = LightBorder,
    outlineVariant = LightCardBorder,
    scrim = Color.Black,
    surfaceBright = LightCard,
    surfaceDim = LightMuted,
    surfaceContainerLowest = LightCard,
    surfaceContainerLow = LightBackground,
    surfaceContainer = LightSecondary,
    surfaceContainerHigh = LightMuted,
    surfaceContainerHighest = LightMuted,
)

internal val BallastDarkColorScheme = darkColorScheme(
    primary = DarkPrimary,
    onPrimary = DarkPrimaryForeground,
    primaryContainer = DarkAccent,
    onPrimaryContainer = DarkAccentForeground,
    inversePrimary = LightPrimary,
    secondary = DarkSecondary,
    onSecondary = DarkSecondaryForeground,
    secondaryContainer = DarkSecondary,
    onSecondaryContainer = DarkSecondaryForeground,
    tertiary = DarkAccent,
    onTertiary = DarkAccentForeground,
    tertiaryContainer = DarkAccent,
    onTertiaryContainer = DarkAccentForeground,
    background = DarkBackground,
    onBackground = DarkForeground,
    surface = DarkCard,
    onSurface = DarkCardForeground,
    surfaceVariant = DarkMuted,
    onSurfaceVariant = DarkMutedForeground,
    surfaceTint = DarkPrimary,
    inverseSurface = LightCard,
    inverseOnSurface = LightCardForeground,
    error = DarkDestructive,
    onError = DarkDestructiveForeground,
    errorContainer = DarkDestructive.copy(alpha = 0.15f),
    onErrorContainer = DarkDestructive,
    outline = DarkBorder,
    outlineVariant = DarkCardBorder,
    scrim = Color.Black,
    surfaceBright = DarkSecondary,
    surfaceDim = DarkBackground,
    surfaceContainerLowest = DarkSidebar,
    surfaceContainerLow = DarkBackground,
    surfaceContainer = DarkCard,
    surfaceContainerHigh = DarkMuted,
    surfaceContainerHighest = DarkMuted,
)

/*
 * Unused-token note: `popover`/`popoverForeground` and `input` are not exposed
 * separately because they are equal to `card`/`cardForeground` and `border`
 * respectively in both themes. Read them as `colorScheme.surface` and
 * `colorScheme.outline`. If the web ever diverges them, they gain fields on
 * [BallastExtendedColors].
 */

/**
 * Defaults to the light set rather than throwing, so a composable that
 * accidentally renders outside [BallastTheme] — a stray Android Studio preview,
 * most often — looks wrong instead of crashing.
 */
val LocalBallastColors = staticCompositionLocalOf { BallastLightExtendedColors }

val MaterialTheme.ballastColors: BallastExtendedColors
    @Composable
    @ReadOnlyComposable
    get() = LocalBallastColors.current
