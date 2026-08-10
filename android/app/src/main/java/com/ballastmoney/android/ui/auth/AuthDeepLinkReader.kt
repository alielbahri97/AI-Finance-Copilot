package com.ballastmoney.android.ui.auth

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.ballastmoney.android.data.auth.AuthCallbackLink
import com.ballastmoney.android.data.auth.AuthCallbackParser

/**
 * The `ballast://auth/...` link that opened the app, if one did.
 *
 * Read from the launching intent rather than through `onNewIntent`, because
 * `MainActivity` is owned by another agent and adding an override there is a
 * change this feature does not need: the manifest entry added for this leaves
 * the activity in its default launch mode, so an emailed link starts a fresh
 * `MainActivity` whose `intent` is the link. The cost is one extra instance on
 * the task stack when the app was already open; the alternative is `singleTask`
 * plus an `onNewIntent` override, which is a bigger edit to a file two features
 * are touching.
 *
 * Remembered against the context so it is parsed once per composition rather
 * than on every recomposition of the shell.
 */
@Composable
fun rememberAuthCallbackLink(): AuthCallbackLink? {
    val context = LocalContext.current
    return remember(context) {
        AuthCallbackParser.parse(context.findActivity()?.intent?.dataString)
    }
}

/**
 * Unwraps whatever `LocalContext` currently is down to the hosting activity.
 *
 * Compose hands out a `ContextThemeWrapper` inside a preview and can hand out
 * other wrappers inside a dialog or a test, so the cast that works on a device
 * is exactly the cast that crashes a preview. Walking the chain returns null in
 * those cases, which is the correct answer: there is no launching intent.
 */
private fun Context.findActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}
