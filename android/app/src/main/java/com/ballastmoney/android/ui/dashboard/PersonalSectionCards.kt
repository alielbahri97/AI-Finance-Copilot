package com.ballastmoney.android.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.Savings
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import com.ballastmoney.android.core.common.MoneyDirection
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.BudgetProgress
import com.ballastmoney.android.core.model.NetWorthSummary
import com.ballastmoney.android.core.model.SavingsGoal
import com.ballastmoney.android.core.model.SubscriptionInsight
import com.ballastmoney.android.core.model.UpcomingBill
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.BallastCardHeader
import com.ballastmoney.android.designsystem.component.BallastProgress
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.CategoryDot
import com.ballastmoney.android.designsystem.component.EmptyState
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyText
import com.ballastmoney.android.designsystem.component.ProgressTone
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors
import java.math.BigDecimal

/**
 * The Personal edition's own cards: budgets, bills, goals, subscriptions and
 * net worth.
 *
 * Each one is gated somewhere else — by permission in
 * [personalDashboardSections], by plan in the same place. These composables
 * assume they are allowed to draw and only decide what to draw.
 */

/** The card shell the non-chart sections share. */
@Composable
fun SectionCard(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    BallastCard(modifier = modifier.fillMaxWidth()) {
        BallastCardHeader(title = title, description = description)
        Spacer(modifier = Modifier.height(BallastSpacing.md))
        content()
    }
}

/**
 * Budgets, as "spent of limit" with a bar.
 *
 * The bar is clamped at full even when the limit is blown, and the tone carries
 * the bad news instead. A bar drawn past its own track reads as a rendering bug,
 * and the amount underneath already says by how much.
 */
@Composable
fun BudgetsCard(
    budgets: List<BudgetProgress>,
    formatter: MoneyFormatter,
    onSetBudget: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SectionCard(title = DashboardCopy.BUDGETS, modifier = modifier) {
        if (budgets.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.AccountBalanceWallet,
                title = DashboardCopy.BUDGETS_EMPTY_TITLE,
                description = DashboardCopy.BUDGETS_EMPTY_BODY,
                primaryAction = {
                    BallastButton(
                        text = DashboardCopy.BUDGETS_EMPTY_ACTION,
                        onClick = onSetBudget,
                        size = ButtonSize.SMALL,
                    )
                },
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.md)) {
                budgets.forEach { budget ->
                    BudgetRow(budget = budget, formatter = formatter)
                }
            }
        }
    }
}

@Composable
private fun BudgetRow(
    budget: BudgetProgress,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    val fraction = fractionOf(budget.spent, budget.limit)
    val tone = when {
        budget.isOverspent -> ProgressTone.DESTRUCTIVE
        fraction > NEARLY_SPENT_FRACTION -> ProgressTone.WARNING
        else -> ProgressTone.DEFAULT
    }
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CategoryDot(colorHex = budget.categoryColor)
            Spacer(modifier = Modifier.width(BallastSpacing.sm))
            Text(
                text = budget.categoryName,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(modifier = Modifier.height(BallastSpacing.xs))
        BallastProgress(
            progress = fraction.coerceIn(0f, 1f),
            label = "${formatter.format(budget.spent)} of ${formatter.format(budget.limit)}",
            tone = tone,
        )
    }
}

@Composable
fun UpcomingBillsCard(
    bills: List<UpcomingBill>,
    formatter: MoneyFormatter,
    onViewAll: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val total = bills.fold(BigDecimal.ZERO) { sum, bill -> sum.add(bill.amount) }
    val shown = bills.take(MAX_BILL_ROWS)
    SectionCard(
        title = DashboardCopy.UPCOMING_BILLS,
        modifier = modifier,
        description = DashboardCopy.upcomingBillsDescription(
            total = if (bills.isEmpty()) null else formatter.format(total),
        ),
    ) {
        if (bills.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.Description,
                title = "Nothing due in the next 45 days",
                description = "Recurring payments and scheduled bills show up here as they approach.",
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                shown.forEach { bill ->
                    DetailRow(
                        title = bill.description,
                        subtitle = listOfNotNull(
                            bill.categoryName,
                            formatter.formatDate(bill.dueDate),
                        ).joinToString(" \u00B7 "),
                        colorHex = bill.categoryColor,
                        amount = bill.amount,
                        direction = MoneyDirection.EXPENSE,
                        formatter = formatter,
                    )
                }
            }
            if (bills.size > shown.size) {
                Spacer(modifier = Modifier.height(BallastSpacing.sm))
                BallastButton(
                    // No bills screen exists in this client yet, so this lands
                    // on the transactions list. Flagged for the coordinating
                    // agent: the destination is a stand-in, not the real one.
                    text = DashboardCopy.allUpcomingBillsLink(bills.size),
                    onClick = onViewAll,
                    variant = ButtonVariant.LINK,
                )
            }
        }
    }
}

@Composable
fun SavingsGoalsCard(
    goals: List<SavingsGoal>,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    SectionCard(title = DashboardCopy.SAVINGS_GOALS, modifier = modifier) {
        if (goals.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.Savings,
                title = DashboardCopy.GOALS_EMPTY_TITLE,
                description = DashboardCopy.GOALS_EMPTY_BODY,
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.md)) {
                goals.forEach { goal ->
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = goal.name,
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            if (goal.targetDate != null) {
                                Text(
                                    text = formatter.formatDate(goal.targetDate),
                                    style = BallastTextStyles.micro,
                                    color = MaterialTheme.ballastColors.mutedForeground,
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(BallastSpacing.xs))
                        BallastProgress(
                            progress = fractionOf(goal.saved, goal.target).coerceIn(0f, 1f),
                            label = "${formatter.format(goal.saved)} of ${formatter.format(goal.target)}",
                            tone = ProgressTone.SUCCESS,
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun SubscriptionsCard(
    subscriptions: List<SubscriptionInsight>,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    SectionCard(title = DashboardCopy.SUBSCRIPTIONS, modifier = modifier) {
        if (subscriptions.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.Repeat,
                title = DashboardCopy.SUBSCRIPTIONS_EMPTY_TITLE,
                description = DashboardCopy.SUBSCRIPTIONS_EMPTY_BODY,
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                subscriptions.forEach { subscription ->
                    DetailRow(
                        title = subscription.merchant,
                        subtitle = listOfNotNull(
                            subscription.cadence,
                            subscription.nextChargeDate?.let { formatter.formatDate(it) },
                        ).joinToString(" \u00B7 "),
                        colorHex = null,
                        amount = subscription.amount,
                        direction = MoneyDirection.EXPENSE,
                        formatter = formatter,
                    )
                }
            }
        }
    }
}

/**
 * Net worth, with the three numbers it is made of.
 *
 * Only shown when the plan includes it *and* the user has actually recorded
 * holdings — a net-worth card that says the same thing as the cash card is
 * noise.
 */
@Composable
fun NetWorthCard(
    netWorth: NetWorthSummary,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    SectionCard(title = DashboardCopy.NET_WORTH, modifier = modifier) {
        MoneyText(
            amount = netWorth.net,
            formatter = formatter,
            size = MoneySize.LG,
            direction = MoneyDirection.NONE,
        )
        Spacer(modifier = Modifier.height(BallastSpacing.md))
        Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.lg)) {
            InlineMetric(
                label = DashboardCopy.ASSETS,
                value = formatter.format(netWorth.assets),
            )
            InlineMetric(
                label = DashboardCopy.DEBTS,
                value = formatter.format(netWorth.debts),
            )
            InlineMetric(
                label = DashboardCopy.CASH,
                value = formatter.format(netWorth.cash),
            )
        }
        Spacer(modifier = Modifier.height(BallastSpacing.xs))
        Text(
            text = DashboardCopy.pluralize(netWorth.holdingCount, "holding"),
            style = BallastTextStyles.micro,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
    }
}

/**
 * A bill or a subscription: swatch, name over detail, amount.
 *
 * Deliberately not `BallastListRow`, which pads itself horizontally by `md` for
 * use in a full-bleed list. Inside a card that already pads by `lg` that would
 * indent every row 12dp past the card's own title.
 */
@Composable
private fun DetailRow(
    title: String,
    subtitle: String,
    colorHex: String?,
    amount: BigDecimal,
    direction: MoneyDirection,
    formatter: MoneyFormatter,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CategoryDot(colorHex = colorHex)
        Spacer(modifier = Modifier.width(BallastSpacing.sm))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle.isNotEmpty()) {
                Text(
                    text = subtitle,
                    style = BallastTextStyles.micro,
                    color = MaterialTheme.ballastColors.mutedForeground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(modifier = Modifier.width(BallastSpacing.sm))
        MoneyText(
            amount = amount,
            formatter = formatter,
            size = MoneySize.SM,
            direction = direction,
        )
    }
}

/**
 * `spent / limit` as a float, defensive about a zero or negative limit — a
 * budget of nothing is either fully spent or meaningless, and dividing by it
 * would throw.
 */
internal fun fractionOf(part: BigDecimal, whole: BigDecimal): Float {
    if (whole.signum() <= 0) return if (part.signum() > 0) 1f else 0f
    return (part.toDouble() / whole.toDouble()).toFloat()
}

/** Above this share of a budget the bar turns amber. */
private const val NEARLY_SPENT_FRACTION = 0.8f

/** The web app shows six and links out for the rest. */
private const val MAX_BILL_ROWS = 6
