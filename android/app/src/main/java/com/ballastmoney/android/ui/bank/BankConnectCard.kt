package com.ballastmoney.android.ui.bank

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.tooling.preview.Preview
import com.ballastmoney.android.data.bank.BankWaitReason
import com.ballastmoney.android.data.bank.PendingBankConnection
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTheme
import java.time.Instant

/**
 * The three things the card can ask for, bundled so a host screen passes one
 * parameter and a preview passes none.
 */
@Immutable
data class BankConnectActions(
    val onCheckNow: () -> Unit = {},
    val onStopWaiting: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
)

/**
 * What is happening with a bank connection the user started.
 *
 * Never error styling, whatever the HTTP status was. An unfinished bank approval
 * is a state of the world, not a fault in the app: the user walked away from
 * their bank's page, or their bank has not confirmed yet. Dressing that in red
 * would tell them something is broken and invite them to report it.
 */
@Composable
fun BankConnectCard(
    state: BankConnectUiState,
    onCheckNow: () -> Unit,
    onStopWaiting: () -> Unit,
    onDismissNotice: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val notice = state.notice ?: return
    val detail = waitReasonText(state.waitReason) ?: notice.description

    BallastAlert(
        title = notice.title,
        modifier = modifier.fillMaxWidth(),
        description = detail,
        variant = variantFor(notice.tone),
        icon = iconFor(notice.tone),
        action = {
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xs)) {
                if (state.hasPending) {
                    BallastButton(
                        text = if (state.checking) "Checking…" else "Check again",
                        onClick = onCheckNow,
                        variant = ButtonVariant.OUTLINE,
                        size = ButtonSize.SMALL,
                        loading = state.checking,
                    )
                    BallastButton(
                        text = "Stop waiting",
                        onClick = onStopWaiting,
                        variant = ButtonVariant.GHOST,
                        size = ButtonSize.SMALL,
                    )
                } else {
                    BallastButton(
                        text = "Dismiss",
                        onClick = onDismissNotice,
                        variant = ButtonVariant.GHOST,
                        size = ButtonSize.SMALL,
                    )
                }
            }
        },
    )
}

/**
 * SUCCESS shares the default treatment rather than borrowing the warning wash:
 * the design system has no success alert, and a green panel for "connected" would
 * be the only one in the app.
 */
private fun variantFor(tone: BankNoticeTone): AlertVariant = when (tone) {
    BankNoticeTone.INFO -> AlertVariant.DEFAULT
    BankNoticeTone.SUCCESS -> AlertVariant.DEFAULT
    BankNoticeTone.WARNING -> AlertVariant.WARNING
}

private fun iconFor(tone: BankNoticeTone): ImageVector = when (tone) {
    BankNoticeTone.INFO -> Icons.Filled.Info
    BankNoticeTone.SUCCESS -> Icons.Filled.CheckCircle
    BankNoticeTone.WARNING -> Icons.Filled.Warning
}

// --- Previews --------------------------------------------------------------

private val PreviewPending = PendingBankConnection(
    reference = "ballast-workspace-1234567890-abcdef",
    institutionId = "ING_INGBNL2A",
    institutionName = "ING",
    expiresAt = Instant.parse("2026-08-10T12:30:00Z"),
)

@Composable
private fun CardPreview(state: BankConnectUiState) {
    Surface(color = MaterialTheme.colorScheme.background) {
        BankConnectCard(
            state = state,
            onCheckNow = {},
            onStopWaiting = {},
            onDismissNotice = {},
            modifier = Modifier.padding(BallastSpacing.lg),
        )
    }
}

@Preview(name = "Bank waiting light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BankWaitingLightPreview() {
    BallastTheme(darkTheme = false) {
        CardPreview(
            BankConnectUiState(
                pending = PreviewPending,
                notice = waitingNotice(PreviewPending),
            ),
        )
    }
}

@Preview(name = "Bank waiting dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun BankWaitingDarkPreview() {
    BallastTheme(darkTheme = true) {
        CardPreview(
            BankConnectUiState(
                pending = PreviewPending,
                checking = true,
                waitReason = BankWaitReason.NOT_YET_APPROVED,
                notice = waitingNotice(PreviewPending),
            ),
        )
    }
}

@Preview(name = "Bank not completed", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BankNotCompletedPreview() {
    BallastTheme(darkTheme = false) {
        CardPreview(
            BankConnectUiState(
                pending = PreviewPending,
                waitReason = BankWaitReason.NOT_COMPLETED_AT_BANK,
                notice = waitingNotice(PreviewPending),
            ),
        )
    }
}

@Preview(name = "Bank gave up", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BankGaveUpPreview() {
    BallastTheme(darkTheme = false) {
        CardPreview(
            BankConnectUiState(
                notice = BankNotice(
                    title = "ING wasn't connected",
                    description = "The bank approval took too long and the attempt " +
                        "expired. Connect again.",
                    tone = BankNoticeTone.WARNING,
                ),
            ),
        )
    }
}

@Preview(name = "Bank connected", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BankConnectedPreview() {
    BallastTheme(darkTheme = false) {
        CardPreview(
            BankConnectUiState(
                notice = BankNotice(
                    title = "ING connected",
                    description = "2 accounts are now syncing.",
                    tone = BankNoticeTone.SUCCESS,
                ),
            ),
        )
    }
}
