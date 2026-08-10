package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyDirection
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.Pill
import com.ballastmoney.android.designsystem.theme.ballastColors
import java.math.BigDecimal

private val RowShape = RoundedCornerShape(BallastRadius.md)

/**
 * The generic list line: a transaction, an account, a settings entry.
 *
 * [selected] paints the accent wash the web uses for the active sidebar item, so
 * a chosen row in a picker sheet reads the same way as a chosen destination.
 */
@Composable
fun BallastListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onClick: (() -> Unit)? = null,
    selected: Boolean = false,
    leading: @Composable (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null,
) {
    val scheme = MaterialTheme.colorScheme
    val extended = MaterialTheme.ballastColors

    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(RowShape)
            .background(if (selected) scheme.primaryContainer else Color.Transparent, RowShape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = BallastSpacing.md, vertical = BallastSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(modifier = Modifier.width(BallastSpacing.md))
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.xxs),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelLarge,
                color = if (selected) extended.accentForeground else scheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = extended.mutedForeground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (trailing != null) {
            Spacer(modifier = Modifier.width(BallastSpacing.md))
            trailing()
        }
    }
}

/**
 * The web's uncategorized swatch, `slate-400`.
 *
 * The only literal colour in the component layer. It is not a theme token — the
 * web hard-codes it too, because "no category" is the absence of a category
 * colour rather than a semantic state, and it has to read the same in both
 * themes so an uncategorised row looks identical wherever it appears.
 */
private val UncategorizedColor = Color(0xFF94A3B8)

/**
 * The category swatch beside a transaction.
 *
 * [colorHex] takes the `#RRGGBB` string the API stores; anything unparseable is
 * treated as "no category" rather than throwing, because a bad colour must never
 * be able to take down a transaction list.
 */
@Composable
fun CategoryDot(
    colorHex: String?,
    modifier: Modifier = Modifier,
    size: Dp = 8.dp,
) {
    Spacer(
        modifier = modifier
            .size(size)
            .background(parseCategoryColor(colorHex), Pill)
    )
}

private fun parseCategoryColor(colorHex: String?): Color {
    val digits = colorHex?.trim()?.removePrefix("#") ?: return UncategorizedColor
    if (digits.length != 6) return UncategorizedColor
    val rgb = digits.toLongOrNull(radix = 16) ?: return UncategorizedColor
    return Color(rgb or 0xFF000000L)
}

// --- Previews --------------------------------------------------------------

@Composable
private fun ListRowGallery() {
    val formatter = MoneyFormatter("USD")
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(modifier = Modifier.padding(BallastSpacing.sm)) {
            BallastListRow(
                title = "Whole Foods Market",
                subtitle = "Groceries · 12 Aug",
                onClick = {},
                leading = { CategoryDot(colorHex = "#008D5B") },
                trailing = {
                    MoneyText(
                        amount = BigDecimal("86.40"),
                        formatter = formatter,
                        direction = MoneyDirection.EXPENSE,
                    )
                },
            )
            BallastSeparator()
            BallastListRow(
                title = "Stripe payout",
                subtitle = "Income · 11 Aug",
                onClick = {},
                leading = { CategoryDot(colorHex = null) },
                trailing = {
                    MoneyText(
                        amount = BigDecimal("4210.00"),
                        formatter = formatter,
                        direction = MoneyDirection.INCOME,
                        tone = MoneyTone.SUCCESS,
                    )
                },
            )
            BallastSeparator()
            BallastListRow(
                title = "Selected row",
                subtitle = "This is what a chosen entry looks like",
                onClick = {},
                selected = true,
                leading = { CategoryDot(colorHex = "#953AE3", size = 10.dp) },
                trailing = { BallastBadge(text = "Active", variant = BadgeVariant.SUCCESS) },
            )
            BallastSeparator()
            BallastListRow(
                title = "A merchant name long enough that it has to be cut short somewhere",
                subtitle = "Uncategorized · 10 Aug",
                leading = { CategoryDot(colorHex = "not-a-colour") },
            )
        }
    }
}

@Preview(name = "List rows light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun ListRowLightPreview() {
    BallastTheme(darkTheme = false) { ListRowGallery() }
}

@Preview(name = "List rows dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun ListRowDarkPreview() {
    BallastTheme(darkTheme = true) { ListRowGallery() }
}
