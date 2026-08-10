package com.ballastmoney.android.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyDirection
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.CashAccount
import com.ballastmoney.android.core.model.CashPosition
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.BallastSeparator
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyText
import com.ballastmoney.android.designsystem.component.MoneyTone
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors
import java.math.BigDecimal

/**
 * The stat cards both editions build their headline row out of.
 *
 * All of these are pure functions of their arguments — including
 * [TotalCashCard], whose expand/collapse flag is hoisted to the screen so the
 * card itself can be dropped into a preview in either position.
 */

/** How wide the viewport has to be before the stat row gains a column. */
private val MEDIUM_WIDTH = 600.dp
private val WIDE_WIDTH = 1000.dp

/**
 * The headline stat row, reflowed for the available width.
 *
 * Phones get the hero card full-width above a two-up grid; a tablet in
 * landscape or a desktop-class window puts all four side by side. The layout is
 * driven by the measured width rather than by a device class because from API 36
 * a 600dp-wide screen can rotate freely and a foldable can change width without
 * a configuration change, so "is this a phone" is not a question worth asking.
 *
 * Each entry receives the [Modifier] it must apply, which is how the grid keeps
 * control of widths without the cards knowing how many columns exist.
 */
@Composable
fun StatCardGrid(
    cards: List<@Composable (Modifier) -> Unit>,
    modifier: Modifier = Modifier,
    heroSpansNarrowWidth: Boolean = true,
) {
    if (cards.isEmpty()) return
    BoxWithConstraints(modifier = modifier) {
        val columns = when {
            maxWidth < MEDIUM_WIDTH -> 2
            maxWidth < WIDE_WIDTH -> 3
            else -> 4
        }
        // With four columns everything already fits on one line, so the hero
        // card only needs its own row while the grid is narrower than the row.
        val heroOnOwnRow = heroSpansNarrowWidth && columns < cards.size
        val hero = if (heroOnOwnRow) cards.first() else null
        val tail = if (heroOnOwnRow) cards.drop(1) else cards

        Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.md)) {
            if (hero != null) hero(Modifier.fillMaxWidth())
            tail.chunked(columns).forEach { rowCards ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(BallastSpacing.md),
                ) {
                    rowCards.forEach { card ->
                        Box(modifier = Modifier.weight(1f)) { card(Modifier.fillMaxWidth()) }
                    }
                    // Keeps a short final row aligned with the rows above it
                    // instead of stretching two cards across four columns.
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A card whose value is an amount of money. */
@Composable
fun MoneyStatCard(
    label: String,
    amount: BigDecimal,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
    hint: String? = null,
    size: MoneySize = MoneySize.MD,
    tone: MoneyTone = MoneyTone.DEFAULT,
    trend: TrendChange? = null,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
) {
    StatCardShell(
        label = label,
        modifier = modifier,
        hint = hint,
        trend = trend,
        footer = footer,
    ) {
        MoneyText(
            amount = amount,
            formatter = formatter,
            size = size,
            direction = MoneyDirection.NONE,
            tone = tone,
        )
    }
}

/** A card whose value is already a string — a percentage, usually. */
@Composable
fun TextStatCard(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
    trend: TrendChange? = null,
) {
    StatCardShell(label = label, modifier = modifier, hint = hint, trend = trend) {
        Text(text = value, style = BallastTextStyles.moneyMd)
    }
}

/**
 * Label and trend badge, the value, the hint, then anything extra.
 *
 * The order matters: the hint explains the value, so it sits directly under it
 * and above [footer]. Rendering the footer first would put "4 accounts at 2
 * banks" underneath an expanded list of those four accounts.
 */
@Composable
private fun StatCardShell(
    label: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
    trend: TrendChange? = null,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    BallastCard(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                style = BallastTextStyles.sectionLabel,
                color = MaterialTheme.ballastColors.mutedForeground,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (trend != null) {
                Spacer(modifier = Modifier.width(BallastSpacing.sm))
                TrendBadge(percent = trend.percent, increaseIsGood = trend.increaseIsGood)
            }
        }
        Spacer(modifier = Modifier.height(BallastSpacing.xs))
        content()
        if (hint != null) {
            Spacer(modifier = Modifier.height(BallastSpacing.xxs))
            Text(
                text = hint,
                style = BallastTextStyles.micro,
                color = MaterialTheme.ballastColors.mutedForeground,
            )
        }
        footer?.invoke(this)
    }
}

/**
 * A month-on-month change and whether going up is a good thing.
 *
 * Income rising is good news; expenses rising is not. Carrying the judgement
 * next to the number stops every call site from re-deciding it, and stops the
 * expenses card from ever being coloured green for growing.
 */
data class TrendChange(
    val percent: Int,
    val increaseIsGood: Boolean,
)

/** `null` percentages produce nothing at all, as on the web. */
fun trendChangeOrNull(percent: Int?, increaseIsGood: Boolean): TrendChange? =
    percent?.let { TrendChange(it, increaseIsGood) }

@Composable
fun TrendBadge(
    percent: Int,
    increaseIsGood: Boolean,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.ballastColors
    val isGoodNews = if (percent >= 0) increaseIsGood else !increaseIsGood
    val foreground = if (isGoodNews) colors.success else colors.destructiveSolid
    val background = if (isGoodNews) colors.successTinted else colors.destructiveTinted
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(BallastRadius.sm))
            .background(background)
            .padding(horizontal = BallastSpacing.xs, vertical = BallastSpacing.xxs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (percent >= 0) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward,
            contentDescription = null,
            tint = foreground,
            modifier = Modifier.size(TREND_ICON_SIZE),
        )
        Spacer(modifier = Modifier.width(BallastSpacing.xxs))
        Text(
            text = DashboardCopy.trendLabel(percent),
            style = BallastTextStyles.micro,
            color = foreground,
        )
    }
}

private val TREND_ICON_SIZE = 12.dp

/**
 * Total cash, with an optional per-account breakdown.
 *
 * The breakdown is the answer to "that number looks wrong": it names every
 * account behind the total and, for the ones that are not in it, says why. The
 * expansion flag is a parameter rather than internal state so the screen owns
 * it, survives rotation with it, and can preview both halves.
 */
@Composable
fun TotalCashCard(
    cash: CashPosition,
    formatter: MoneyFormatter,
    expanded: Boolean,
    onToggleExpanded: () -> Unit,
    modifier: Modifier = Modifier,
    size: MoneySize = MoneySize.HERO,
) {
    MoneyStatCard(
        label = DashboardCopy.TOTAL_CASH,
        amount = cash.total,
        formatter = formatter,
        modifier = modifier,
        hint = DashboardCopy.cashHint(cash),
        size = size,
        tone = if (cash.total.signum() >= 0) MoneyTone.SUCCESS else MoneyTone.DESTRUCTIVE,
        footer = {
            // Nothing to break down when the total came straight from the
            // transaction history, so the toggle is not offered at all.
            if (cash.accounts.isNotEmpty()) {
                Spacer(modifier = Modifier.height(BallastSpacing.xs))
                BallastButton(
                    text = if (expanded) {
                        DashboardCopy.HIDE_BREAKDOWN
                    } else {
                        DashboardCopy.SHOW_BREAKDOWN
                    },
                    onClick = onToggleExpanded,
                    variant = ButtonVariant.LINK,
                    size = ButtonSize.SMALL,
                )
                if (expanded) {
                    Spacer(modifier = Modifier.height(BallastSpacing.xs))
                    BallastSeparator()
                    cash.accounts.forEach { account ->
                        CashAccountRow(account = account, formatter = formatter)
                    }
                }
            }
        },
    )
}

@Composable
private fun CashAccountRow(
    account: CashAccount,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.ballastColors
    val note = DashboardCopy.exclusionNote(account.exclusionReason, account.currency)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = BallastSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = account.name,
                style = MaterialTheme.typography.bodyMedium,
            )
            val subtitle = listOfNotNull(account.mask?.let { "\u2022\u2022$it" }, note)
                .joinToString(" \u00B7 ")
            if (subtitle.isNotEmpty()) {
                Text(
                    text = subtitle,
                    style = BallastTextStyles.micro,
                    color = colors.mutedForeground,
                )
            }
        }
        Spacer(modifier = Modifier.width(BallastSpacing.sm))
        val balance = account.balance
        when {
            balance == null -> Text(
                text = "\u2014",
                style = BallastTextStyles.moneySm,
                color = colors.mutedForeground,
            )
            // Struck through rather than hidden: the balance is real, it just
            // is not part of the total above.
            !account.includeInTotals -> Text(
                text = formatter.format(balance),
                style = BallastTextStyles.moneySm,
                color = colors.mutedForeground,
                textDecoration = TextDecoration.LineThrough,
            )
            else -> MoneyText(
                amount = balance,
                formatter = formatter,
                size = MoneySize.SM,
                direction = MoneyDirection.NONE,
            )
        }
    }
}

/** A small labelled figure, used inside the forecast and net-worth cards. */
@Composable
fun InlineMetric(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color? = null,
) {
    Column(modifier = modifier) {
        Text(
            text = label,
            style = BallastTextStyles.micro,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
        Text(
            text = value,
            style = BallastTextStyles.moneySm,
            color = valueColor ?: MaterialTheme.colorScheme.onSurface,
        )
    }
}
