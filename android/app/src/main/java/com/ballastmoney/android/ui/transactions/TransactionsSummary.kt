package com.ballastmoney.android.ui.transactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.common.MoneyDirection
import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.TransactionAggregates
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.MoneySize
import com.ballastmoney.android.designsystem.component.MoneyText
import com.ballastmoney.android.designsystem.component.MoneyTone
import com.ballastmoney.android.designsystem.component.Skeleton
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors
import java.math.BigDecimal

/**
 * Income, expenses and net for the **whole filtered set**, which is why these
 * come from the aggregates endpoint and not from the loaded page: the phone only
 * ever holds a window of the results, so summing what is on screen would be
 * confidently wrong.
 */
@Composable
internal fun TransactionAggregateTiles(
    aggregates: TransactionAggregates?,
    formatter: MoneyFormatter,
    currencyCode: String,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.ballastColors
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
            AggregateTile(
                label = "Income",
                amount = aggregates?.income,
                formatter = formatter,
                direction = MoneyDirection.INCOME,
                tone = MoneyTone.SUCCESS,
                modifier = Modifier.weight(1f),
            )
            AggregateTile(
                label = "Expenses",
                amount = aggregates?.expenses,
                formatter = formatter,
                direction = MoneyDirection.EXPENSE,
                tone = MoneyTone.DESTRUCTIVE,
                modifier = Modifier.weight(1f),
            )
            AggregateTile(
                label = "Net",
                amount = aggregates?.net,
                formatter = formatter,
                direction = MoneyDirection.NONE,
                tone = if ((aggregates?.net ?: BigDecimal.ZERO).signum() < 0) {
                    MoneyTone.DESTRUCTIVE
                } else {
                    MoneyTone.SUCCESS
                },
                modifier = Modifier.weight(1f),
            )
        }

        if (aggregates != null) {
            Text(
                text = "${formatCount(aggregates.totalCount, currencyCode)} matching",
                style = BallastTextStyles.micro,
                color = colors.mutedForeground,
            )
        }
    }
}

@Composable
private fun AggregateTile(
    label: String,
    amount: BigDecimal?,
    formatter: MoneyFormatter,
    direction: MoneyDirection,
    tone: MoneyTone,
    modifier: Modifier = Modifier,
) {
    BallastCard(modifier = modifier) {
        TileBody(label = label, amount = amount, formatter = formatter, direction = direction, tone = tone)
    }
}

@Composable
private fun TileBody(
    label: String,
    amount: BigDecimal?,
    formatter: MoneyFormatter,
    direction: MoneyDirection,
    tone: MoneyTone,
) {
    Text(
        text = label,
        style = BallastTextStyles.sectionLabel,
        color = MaterialTheme.ballastColors.mutedForeground,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
    if (amount == null) {
        Skeleton(
            modifier = Modifier
                .padding(top = BallastSpacing.xs)
                .fillMaxWidth()
                .height(20.dp),
        )
    } else {
        MoneyText(
            amount = amount,
            formatter = formatter,
            direction = direction,
            size = MoneySize.SM,
            tone = tone,
        )
    }
}

/**
 * The teaching nudge. `count` is the number of uncategorized rows we know about;
 * see [TransactionsScreen] for why that is the loaded window rather than a
 * server-side total.
 */
@Composable
internal fun UncategorizedNudge(
    count: Int,
    onStartTeaching: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val batch = minOf(NUDGE_BATCH_SIZE, count)
    BallastAlert(
        title = "Got 5 minutes? Teach Ballast your categories",
        modifier = modifier,
        description = "Labelling the largest ones first teaches the categoriser the most, fastest.",
        variant = AlertVariant.WARNING,
        icon = Icons.Filled.AutoAwesome,
        action = {
            BallastButton(
                text = "Start with $batch biggest",
                onClick = onStartTeaching,
                variant = ButtonVariant.OUTLINE,
                size = ButtonSize.SMALL,
            )
        },
    )
}

private const val NUDGE_BATCH_SIZE = 8
