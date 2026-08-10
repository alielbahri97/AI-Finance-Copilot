package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import com.ballastmoney.android.core.common.MoneyDirection
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors
import java.math.BigDecimal

enum class MoneySize { SM, MD, LG, HERO }

enum class MoneyTone { DEFAULT, SUCCESS, DESTRUCTIVE, MUTED }

/**
 * Every amount in the app.
 *
 * [tone] is independent of [direction] on purpose: a row can show a signed
 * expense in the default ink (the sign already says which way it went) or an
 * unsigned balance in the destructive tone because it is overdrawn. Colour and
 * sign answer different questions, and colour alone is never the only signal.
 */
@Composable
fun MoneyText(
    amount: BigDecimal,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
    size: MoneySize = MoneySize.SM,
    direction: MoneyDirection = MoneyDirection.NONE,
    tone: MoneyTone = MoneyTone.DEFAULT,
) {
    val style: TextStyle = when (size) {
        MoneySize.SM -> BallastTextStyles.moneySm
        MoneySize.MD -> BallastTextStyles.moneyMd
        MoneySize.LG -> BallastTextStyles.moneyLg
        MoneySize.HERO -> BallastTextStyles.moneyHero
    }
    val extended = MaterialTheme.ballastColors
    val color = when (tone) {
        MoneyTone.DEFAULT -> MaterialTheme.colorScheme.onSurface
        MoneyTone.SUCCESS -> extended.success
        MoneyTone.DESTRUCTIVE -> MaterialTheme.colorScheme.error
        MoneyTone.MUTED -> extended.mutedForeground
    }

    Text(
        text = formatter.formatSigned(amount, direction),
        modifier = modifier,
        style = style,
        color = color,
        // An amount that wraps is unreadable; let the layout clip or scroll
        // instead of breaking the figure across lines.
        maxLines = 1,
        softWrap = false,
    )
}

// --- Previews --------------------------------------------------------------

@Composable
private fun MoneyGallery() {
    val formatter = MoneyFormatter("USD")
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            MoneyText(
                amount = BigDecimal("128450.09"),
                formatter = formatter,
                size = MoneySize.HERO,
            )
            MoneyText(
                amount = BigDecimal("4820.00"),
                formatter = formatter,
                size = MoneySize.LG,
                direction = MoneyDirection.INCOME,
                tone = MoneyTone.SUCCESS,
            )
            MoneyText(
                amount = BigDecimal("1290.50"),
                formatter = formatter,
                size = MoneySize.MD,
                direction = MoneyDirection.EXPENSE,
                tone = MoneyTone.DESTRUCTIVE,
            )
            // Tabular figures mean these three line up character for character.
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.xs)) {
                MoneyText(amount = BigDecimal("1111.11"), formatter = formatter)
                MoneyText(amount = BigDecimal("8888.88"), formatter = formatter)
                MoneyText(amount = BigDecimal("100.05"), formatter = formatter)
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MoneyText(
                    amount = BigDecimal("42.00"),
                    formatter = formatter,
                    tone = MoneyTone.MUTED,
                )
                MoneyText(
                    amount = BigDecimal("0.00"),
                    formatter = MoneyFormatter("EUR"),
                    size = MoneySize.MD,
                )
                MoneyText(
                    amount = BigDecimal("-95.40"),
                    formatter = MoneyFormatter("GBP"),
                    size = MoneySize.MD,
                    tone = MoneyTone.DESTRUCTIVE,
                )
            }
        }
    }
}

@Preview(name = "Money light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun MoneyLightPreview() {
    BallastTheme(darkTheme = false) { MoneyGallery() }
}

@Preview(name = "Money dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun MoneyDarkPreview() {
    BallastTheme(darkTheme = true) { MoneyGallery() }
}
