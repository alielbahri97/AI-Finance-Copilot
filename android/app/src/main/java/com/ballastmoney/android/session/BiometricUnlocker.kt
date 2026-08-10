package com.ballastmoney.android.session

import android.content.Context
import android.content.ContextWrapper
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/** What the device can actually offer, which decides what the lock screen shows. */
enum class BiometricAvailability {
    /** A fingerprint, face or device credential can be used right now. */
    AVAILABLE,

    /** Hardware exists but nothing is enrolled, so offer to open Settings. */
    NOT_ENROLLED,

    /** No usable hardware or credential. The only way out is to sign in again. */
    UNAVAILABLE,
}

/**
 * Thin wrapper over [BiometricPrompt].
 *
 * Device credential is accepted alongside biometrics on purpose: a PIN or
 * pattern is the fallback people actually have, and refusing it would strand
 * anyone whose fingerprint sensor is wet. That also means no negative button —
 * the platform will not allow one when device credential is enabled.
 */
class BiometricUnlocker(private val activity: FragmentActivity) {

    private val authenticators =
        BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL

    fun availability(): BiometricAvailability =
        when (BiometricManager.from(activity).canAuthenticate(authenticators)) {
            BiometricManager.BIOMETRIC_SUCCESS -> BiometricAvailability.AVAILABLE
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> BiometricAvailability.NOT_ENROLLED
            else -> BiometricAvailability.UNAVAILABLE
        }

    fun prompt(
        title: String,
        subtitle: String,
        onSuccess: () -> Unit,
        onFailed: (message: String?) -> Unit,
    ) {
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onSuccess()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    // A cancel is the user's choice, not a problem to report; a
                    // lockout or hardware error is worth showing.
                    val silent = errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                        errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                        errorCode == BiometricPrompt.ERROR_CANCELED
                    onFailed(if (silent) null else errString.toString())
                }
            },
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setAllowedAuthenticators(authenticators)
                .setConfirmationRequired(false)
                .build(),
        )
    }
}

/**
 * Null in a preview or any other context that is not a [FragmentActivity], which
 * lets the lock screen render in tooling without a live prompt.
 */
@Composable
fun rememberBiometricUnlocker(): BiometricUnlocker? {
    val context = LocalContext.current
    return remember(context) {
        context.findFragmentActivity()?.let(::BiometricUnlocker)
    }
}

private fun Context.findFragmentActivity(): FragmentActivity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is FragmentActivity) return current
        current = current.baseContext
    }
    return null
}
