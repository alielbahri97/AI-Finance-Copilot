package com.ballastmoney.android.ui.lock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import com.ballastmoney.android.designsystem.brand.BallastLogo
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors
import com.ballastmoney.android.session.BiometricAvailability
import com.ballastmoney.android.session.rememberBiometricUnlocker
import androidx.compose.ui.unit.dp

/**
 * The lock screen, shown instead of the navigation graph rather than on top of
 * it: nothing underneath is composed, so no balance can be read through an
 * animation and no screen behind it keeps polling.
 *
 * The prompt fires by itself on arrival. Making the user tap "Unlock" before the
 * system sheet appears adds a step to something that happens several times a day,
 * and the sheet is cancellable anyway.
 */
@Composable
fun SessionLockScreen(
    biometricUnlockEnabled: Boolean,
    onUnlocked: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val unlocker = rememberBiometricUnlocker()
    val availability = remember(unlocker) {
        unlocker?.availability() ?: BiometricAvailability.UNAVAILABLE
    }
    var message by remember { mutableStateOf<String?>(null) }
    var promptShown by remember { mutableStateOf(false) }

    fun authenticate() {
        val active = unlocker ?: return
        message = null
        active.prompt(
            title = "Unlock Ballast",
            subtitle = "Confirm it is you to see your accounts",
            onSuccess = onUnlocked,
            onFailed = { failure -> message = failure },
        )
    }

    LaunchedEffect(availability, biometricUnlockEnabled) {
        if (!promptShown && biometricUnlockEnabled && availability == BiometricAvailability.AVAILABLE) {
            promptShown = true
            authenticate()
        }
    }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .padding(horizontal = BallastSpacing.xl),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            BallastLogo(size = 48.dp, showWordmark = true)

            Spacer(Modifier.height(BallastSpacing.xl))

            Text(
                text = "Ballast is locked",
                style = BallastTextStyles.pageTitle,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(BallastSpacing.sm))
            Text(
                text = when (availability) {
                    BiometricAvailability.AVAILABLE ->
                        "Unlock with your fingerprint, face or device PIN to continue."
                    BiometricAvailability.NOT_ENROLLED ->
                        "Set up a screen lock in Android settings to unlock Ballast without signing in again."
                    BiometricAvailability.UNAVAILABLE ->
                        "This device has no screen lock, so there is nothing to check against."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.ballastColors.mutedForeground,
                textAlign = TextAlign.Center,
            )

            message?.let { text ->
                Spacer(Modifier.height(BallastSpacing.md))
                Text(
                    text = text,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.height(BallastSpacing.xl))

            when (availability) {
                BiometricAvailability.AVAILABLE -> BallastButton(
                    text = "Unlock",
                    onClick = ::authenticate,
                    leadingIcon = Icons.Outlined.Fingerprint,
                    fillMaxWidth = true,
                )
                // With no credential enrolled there is nothing to authenticate
                // against, and the device itself is already unprotected, so
                // refusing entry would only lock the owner out of their own data.
                BiometricAvailability.NOT_ENROLLED,
                BiometricAvailability.UNAVAILABLE,
                -> BallastButton(
                    text = "Continue",
                    onClick = onUnlocked,
                    fillMaxWidth = true,
                )
            }

            Spacer(Modifier.height(BallastSpacing.sm))
            BallastButton(
                text = "Sign out",
                onClick = onSignOut,
                variant = ButtonVariant.GHOST,
                fillMaxWidth = true,
            )
        }
    }
}

@Preview(name = "Session lock", showBackground = true)
@Composable
private fun SessionLockPreview() {
    BallastTheme {
        SessionLockScreen(
            biometricUnlockEnabled = true,
            onUnlocked = {},
            onSignOut = {},
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
