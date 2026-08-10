package com.ballastmoney.android.ui.accounts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.model.ProviderCapability
import com.ballastmoney.android.designsystem.component.BadgeVariant
import com.ballastmoney.android.designsystem.component.BallastBadge
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * Small shared pieces of the accounts screen. Nothing here holds state or
 * knows a repository exists.
 */

@Composable
fun statusToneColor(tone: StatusTone): Color = when (tone) {
    StatusTone.SUCCESS -> MaterialTheme.ballastColors.success
    StatusTone.WARNING -> MaterialTheme.ballastColors.warning
    StatusTone.DESTRUCTIVE -> MaterialTheme.ballastColors.destructiveSolid
    StatusTone.MUTED -> MaterialTheme.ballastColors.mutedForeground
    StatusTone.INFO -> MaterialTheme.colorScheme.primary
}

fun badgeVariantFor(tone: StatusTone): BadgeVariant = when (tone) {
    StatusTone.SUCCESS -> BadgeVariant.SUCCESS
    StatusTone.WARNING -> BadgeVariant.WARNING
    StatusTone.DESTRUCTIVE -> BadgeVariant.DESTRUCTIVE
    StatusTone.MUTED -> BadgeVariant.SECONDARY
    StatusTone.INFO -> BadgeVariant.OUTLINE
}

/** The coloured pip in front of a tile's status label. */
@Composable
fun StatusDot(tone: StatusTone, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(DotSize)
            .background(statusToneColor(tone), CircleShape),
    )
}

/** A muted supporting line: sync times, consent dates, counts. */
@Composable
fun InfoLine(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.ballastColors.mutedForeground,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = color,
        modifier = modifier,
    )
}

/**
 * The "How to connect" list. Numbered rather than bulleted because the order
 * matters — you cannot approve access before you have picked a bank.
 */
@Composable
fun NumberedSteps(steps: List<String>, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
    ) {
        steps.forEachIndexed { index, step ->
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    modifier = Modifier
                        .size(StepBadgeSize)
                        .background(
                            MaterialTheme.colorScheme.surfaceVariant,
                            CircleShape,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "${index + 1}",
                        style = BallastTextStyles.micro,
                        color = MaterialTheme.ballastColors.mutedForeground,
                        textAlign = TextAlign.Center,
                    )
                }
                Spacer(Modifier.width(BallastSpacing.sm))
                Text(
                    text = step,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.ballastColors.mutedForeground,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/** What the provider is allowed to do, as outline badges. */
@Composable
fun CapabilityBadges(
    capabilities: Set<ProviderCapability>,
    modifier: Modifier = Modifier,
) {
    if (capabilities.isEmpty()) return
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
    ) {
        // A provider declares one or two capabilities in practice, so a plain
        // row never needs to wrap.
        capabilities.forEach { capability ->
            BallastBadge(text = capabilityLabel(capability), variant = BadgeVariant.OUTLINE)
        }
    }
}

/** A heading for a block inside a card or sheet. */
@Composable
fun BlockHeading(text: String, modifier: Modifier = Modifier) {
    Text(
        // `sectionLabel` is spaced for capitals and expects the caller to case
        // the string, matching the web's `uppercase` eyebrow.
        text = text.uppercase(),
        style = BallastTextStyles.sectionLabel,
        color = MaterialTheme.ballastColors.mutedForeground,
        modifier = modifier.padding(bottom = BallastSpacing.xs),
    )
}

private val DotSize = 6.dp
private val StepBadgeSize = 20.dp
