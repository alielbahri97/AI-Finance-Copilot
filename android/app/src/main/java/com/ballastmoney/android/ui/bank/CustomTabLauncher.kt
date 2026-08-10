package com.ballastmoney.android.ui.bank

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent

/** What happened when the app tried to put a bank's consent page in front of the user. */
sealed interface ConsentTabResult {

    /** A Custom Tab opened: the app's colours, the bank's URL bar. */
    data object CustomTab : ConsentTabResult

    /** No Custom Tab was available, so a plain browser took the URL instead. */
    data object PlainBrowser : ConsentTabResult

    /** Nothing on the device can open a web page. [message] is for the user. */
    data class NoBrowser(val message: String) : ConsentTabResult
}

/**
 * Opens a bank's consent page in a Chrome Custom Tab.
 *
 * ### Why never a WebView
 *
 * Because it would not work. Banks block embedded web views for credential
 * entry — it is the standard defence against an app harvesting the credentials
 * typed into a view it controls, and both FIDO/WebAuthn and most banks' own app
 * hand-offs refuse to run in one. A WebView here would not degrade gracefully:
 * the user would reach their bank's login page and be told to use a real browser,
 * with the app looking broken. A Custom Tab hands the page to the user's actual
 * browser, with its cookie jar, its password manager and its address bar, and is
 * what open banking expects.
 *
 * ### Why the fallback is a try/catch rather than a capability query
 *
 * The obvious way to ask "does anything support Custom Tabs" is
 * `CustomTabsClient.getPackageName`, which resolves the Custom Tabs *service*.
 * From Android 11 onwards that needs a `<queries>` declaration in the manifest,
 * and without one it answers "nothing" even on a phone with Chrome installed —
 * so a capability check would route everyone down the fallback path and report no
 * browser to people who have one. Launching and catching
 * [ActivityNotFoundException] needs no package-visibility declaration and is
 * correct on every version: a `CustomTabsIntent` is an `ACTION_VIEW` intent with
 * extras, so a browser that does not implement Custom Tabs simply opens it as an
 * ordinary tab and ignores them.
 *
 * [toolbarColor] is an ARGB int, normally the theme's surface colour, so the tab
 * does not flash a stock white bar in front of a dark app.
 */
fun openBankConsent(context: Context, url: String, toolbarColor: Int): ConsentTabResult {
    val uri = Uri.parse(url)
    val colors = CustomTabColorSchemeParams.Builder()
        .setToolbarColor(toolbarColor)
        .build()
    val customTab = CustomTabsIntent.Builder()
        // The title carries the bank's own page name, which is the one thing that
        // tells a user they are on their bank's site and not still inside Ballast.
        .setShowTitle(true)
        // The URL bar stays put on purpose: it is the only anti-phishing signal
        // the user has while typing bank credentials, and hiding it to gain a
        // strip of screen would be the wrong trade on this screen of all screens.
        .setUrlBarHidingEnabled(false)
        .setDefaultColorSchemeParams(colors)
        .build()

    val host = context.findActivity()
    if (host == null) {
        // Only reachable if this is ever called from something other than the
        // activity's own composition; starting an activity from a non-activity
        // context without this flag throws.
        customTab.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    val launchContext = host ?: context

    return try {
        customTab.launchUrl(launchContext, uri)
        ConsentTabResult.CustomTab
    } catch (noCustomTab: ActivityNotFoundException) {
        try {
            val plain = Intent(Intent.ACTION_VIEW, uri)
            if (host == null) plain.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            launchContext.startActivity(plain)
            ConsentTabResult.PlainBrowser
        } catch (noBrowser: ActivityNotFoundException) {
            ConsentTabResult.NoBrowser(NO_BROWSER_MESSAGE)
        }
    }
}

/**
 * Brings the app's own activity back to the front, which finishes a Custom Tab
 * still sitting on top of it.
 *
 * A Custom Tab has no close API — it is an activity in the host app's task, and
 * the supported way to dismiss it is to re-launch the activity underneath it with
 * `CLEAR_TOP`. This is what stops a user who swiped back to Ballast from the
 * recents list finding a stale bank page again when they press back.
 *
 * Best-effort by design: if the activity cannot be re-launched the only
 * consequence is that a tab the user has already left stays in the task, which
 * they can close themselves. Failing the resume over it would be worse.
 */
fun dismissBankConsent(context: Context) {
    val activity = context.findActivity() ?: return
    val reopen = Intent(activity, activity.javaClass)
        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    runCatching { activity.startActivity(reopen) }
}

/**
 * Walks the context chain to the hosting activity.
 *
 * Written by hand rather than using `LocalActivity`, so that this file needs no
 * Compose dependency and can be called from anywhere holding a `Context`.
 */
private fun Context.findActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}

private const val NO_BROWSER_MESSAGE =
    "There's no browser on this device, so your bank's approval page can't be opened. " +
        "Install a browser, or connect this bank from the Ballast website."
