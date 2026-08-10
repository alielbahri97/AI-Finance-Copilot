package com.ballastmoney.android.designsystem.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.ballastmoney.android.R

/**
 * The two families the design uses: Inter for everything, JetBrains Mono for
 * code, matching the web app.
 *
 * Static weights rather than the variable face. Compose resolves a weight by
 * picking the closest declared [Font], so the four weights the type scale
 * actually names — Normal, Medium, SemiBold, Bold — are each shipped as their
 * own file. A variable font would be one smaller file, but `res/font` support
 * for named instances needs API 26+ *and* an XML family declaring each
 * variation, and the four static faces cost about 1.7 MB with none of that
 * fragility.
 *
 * Both families are SIL Open Font License 1.1; the licences ship in the APK
 * under `assets/licenses/`.
 */
object BallastFontFamilies {
    val sans: FontFamily = FontFamily(
        Font(R.font.inter_regular, FontWeight.Normal),
        Font(R.font.inter_medium, FontWeight.Medium),
        Font(R.font.inter_semibold, FontWeight.SemiBold),
        Font(R.font.inter_bold, FontWeight.Bold),
    )

    /** Code and identifiers only. Money uses [sans] — see [BallastTextStyles]. */
    val mono: FontFamily = FontFamily(
        Font(R.font.jetbrains_mono_regular, FontWeight.Normal),
        Font(R.font.jetbrains_mono_medium, FontWeight.Medium),
    )
}

/**
 * Every figure in the app is monospaced-by-feature rather than monospaced-by-
 * family: `tnum` gives all digits the same advance width so a column of amounts
 * lines up and a live-updating total does not jitter, and `zero` slashes the
 * zero so `0` cannot be misread as `O`. The web asks for the same pair via
 * `font-variant-numeric: tabular-nums slashed-zero`.
 *
 * This deliberately does not switch to [BallastFontFamilies.mono]: the web
 * reserves the mono face for code, and monospaced letters in a currency symbol
 * or thousands separator look wrong next to Inter body text.
 */
private const val TABULAR_FIGURES = "tnum, zero"

private val Sans = BallastFontFamilies.sans

/**
 * Ballast type scale, mapped onto Material's slots.
 *
 * The web's default UI size is 14sp (`text-sm`), not Material's 16sp, so
 * `bodyMedium` and `labelLarge` are the workhorses and most components name them
 * explicitly rather than relying on a component's Material default.
 */
val BallastTypography: Typography = Typography(
    displayLarge = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Bold,
        fontSize = 36.sp,
        lineHeight = 40.sp,
        letterSpacing = (-0.9).sp,
    ),
    displayMedium = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 30.sp,
        lineHeight = 36.sp,
        letterSpacing = (-0.6).sp,
    ),
    displaySmall = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
        letterSpacing = (-0.48).sp,
    ),
    headlineLarge = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 30.sp,
        lineHeight = 36.sp,
        letterSpacing = (-0.6).sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
        letterSpacing = (-0.48).sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
        letterSpacing = (-0.4).sp,
    ),
    titleLarge = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
        lineHeight = 24.sp,
        letterSpacing = (-0.36).sp,
    ),
    titleMedium = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.sp,
    ),
)

/**
 * The styles that have no Material slot: the four money sizes and the small
 * label treatments the web uses for table headers and section eyebrows.
 */
object BallastTextStyles {

    /** Inline list and table-cell amounts. */
    val moneySm: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 18.sp,
        letterSpacing = (-0.35).sp,
        fontFeatureSettings = TABULAR_FIGURES,
    )

    /** Row-primary figures and mobile cards. */
    val moneyMd: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 20.sp,
        letterSpacing = (-0.4).sp,
        fontFeatureSettings = TABULAR_FIGURES,
    )

    /** KPI strips and summary tiles. */
    val moneyLg: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = (-0.55).sp,
        fontFeatureSettings = TABULAR_FIGURES,
    )

    /** Hero balances: one per screen at most. */
    val moneyHero: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Bold,
        fontSize = 36.sp,
        lineHeight = 40.sp,
        letterSpacing = (-0.9).sp,
        fontFeatureSettings = TABULAR_FIGURES,
    )

    /** Eyebrow above a group. Callers uppercase the string themselves. */
    val sectionLabel: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.6.sp,
    )

    /** Column headings in dense tables. Callers uppercase the string. */
    val tableHeader: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.6.sp,
    )

    /** `--text-2xs`: badges, counts, timestamps. */
    val micro: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.sp,
    )

    val pageTitle: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 30.sp,
        lineHeight = 36.sp,
        letterSpacing = (-0.6).sp,
    )

    val sectionTitle: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
        lineHeight = 24.sp,
        letterSpacing = (-0.36).sp,
    )

    val cardTitle: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.sp,
    )

    /** Muted body copy: same size as [BallastTypography] body, looser leading. */
    val mutedBody: TextStyle = TextStyle(
        fontFamily = Sans,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 22.sp,
        letterSpacing = 0.sp,
    )
}
