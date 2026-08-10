package com.ballastmoney.android

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import com.ballastmoney.android.ui.shell.BallastApp
import dagger.hilt.android.AndroidEntryPoint

/**
 * The only activity.
 *
 * It extends [FragmentActivity] because `BiometricPrompt` requires one; the
 * fragment manager is otherwise unused, and everything on screen is Compose.
 */
@AndroidEntryPoint
class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applySecureFlag()

        // API 36 removes the edge-to-edge opt-out, so this is not a choice any
        // more; calling it explicitly keeps behaviour identical on older
        // releases instead of only appearing correct on the newest one.
        enableEdgeToEdge()

        setContent { BallastApp() }
    }

    /**
     * Keeps account balances out of the recent-apps screenshot and off external
     * displays.
     *
     * FLAG_SECURE also blocks the user's own screenshots, which is the cost of it
     * — banking apps accept that trade and so does this one. It is left off in
     * debug builds so development, screenshots for review and instrumented UI
     * tests are still possible.
     */
    private fun applySecureFlag() {
        if (!BuildConfig.DEBUG) {
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}
