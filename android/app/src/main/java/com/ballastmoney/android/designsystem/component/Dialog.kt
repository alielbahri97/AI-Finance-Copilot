package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * A confirmation dialog.
 *
 * [loading] keeps the dialog open and blocks both buttons while the action runs,
 * which is the honest behaviour for anything that can fail — dismissing
 * optimistically would leave the user with no way back to the error.
 */
@Composable
fun BallastAlertDialog(
    onDismissRequest: () -> Unit,
    title: String,
    confirmText: String,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
    dismissText: String = "Cancel",
    destructive: Boolean = false,
    loading: Boolean = false,
) {
    val descriptionText: String? = description
    val body: (@Composable () -> Unit)? = if (descriptionText == null) {
        null
    } else {
        {
            Text(
                text = descriptionText,
                style = BallastTextStyles.mutedBody,
                color = MaterialTheme.ballastColors.mutedForeground,
            )
        }
    }

    AlertDialog(
        onDismissRequest = {
            if (!loading) onDismissRequest()
        },
        confirmButton = {
            BallastButton(
                text = confirmText,
                onClick = onConfirm,
                variant = if (destructive) ButtonVariant.DESTRUCTIVE else ButtonVariant.PRIMARY,
                size = ButtonSize.SMALL,
                loading = loading,
            )
        },
        modifier = modifier,
        dismissButton = {
            BallastButton(
                text = dismissText,
                onClick = onDismissRequest,
                variant = ButtonVariant.GHOST,
                size = ButtonSize.SMALL,
                enabled = !loading,
            )
        },
        title = {
            Text(text = title, style = BallastTextStyles.sectionTitle)
        },
        text = body,
        shape = RoundedCornerShape(BallastRadius.xl),
        // `popover` on the web, which is the same value as `card`.
        containerColor = MaterialTheme.colorScheme.surface,
        titleContentColor = MaterialTheme.colorScheme.onSurface,
        textContentColor = MaterialTheme.ballastColors.mutedForeground,
    )
}

// --- Previews --------------------------------------------------------------

@Preview(name = "Dialog light")
@Composable
private fun DialogLightPreview() {
    BallastTheme(darkTheme = false) {
        BallastAlertDialog(
            onDismissRequest = {},
            title = "Disconnect Monzo?",
            confirmText = "Disconnect",
            onConfirm = {},
            description = "Transactions already imported stay in Ballast. " +
                "New ones will stop arriving until you reconnect.",
            destructive = true,
        )
    }
}

@Preview(name = "Dialog dark")
@Composable
private fun DialogDarkPreview() {
    BallastTheme(darkTheme = true) {
        BallastAlertDialog(
            onDismissRequest = {},
            title = "Disconnect Monzo?",
            confirmText = "Disconnect",
            onConfirm = {},
            description = "Transactions already imported stay in Ballast. " +
                "New ones will stop arriving until you reconnect.",
            destructive = true,
        )
    }
}

@Preview(name = "Dialog loading")
@Composable
private fun DialogLoadingPreview() {
    BallastTheme(darkTheme = false) {
        BallastAlertDialog(
            onDismissRequest = {},
            title = "Sync now?",
            confirmText = "Sync",
            onConfirm = {},
            description = "This pulls the last 90 days from every connected account.",
            loading = true,
        )
    }
}
