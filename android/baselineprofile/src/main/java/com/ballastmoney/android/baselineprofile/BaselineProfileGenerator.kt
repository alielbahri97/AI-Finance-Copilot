package com.ballastmoney.android.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.filters.LargeTest
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import org.junit.Rule
import org.junit.Test

/**
 * Records the classes and methods used during startup and the first interactions,
 * so R8 can lay them out for ahead-of-time compilation.
 *
 * The journey deliberately goes further than a cold start: the dashboard's charts
 * and the transactions list are the two places a first-run user waits, and Compose
 * plus Vico pull in a lot of code the first time either is drawn.
 *
 * Run with `gradlew :baselineprofile:generateBaselineProfile` against a rooted
 * emulator or an `aosp` system image; it cannot run on a normal retail device.
 */
@LargeTest
class BaselineProfileGenerator {

    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun generate() {
        val targetPackage = InstrumentationRegistry.getArguments().getString("targetAppId")
            ?: error("targetAppId not set; the baselineprofile plugin passes it via instrumentation arguments")

        rule.collect(packageName = targetPackage) {
            pressHome()
            startActivityAndWait()

            // Let the dashboard settle: the charts are the expensive part of the
            // first frame and are what this profile is really for.
            device.waitForIdle()

            // Bottom bar: transactions, then back to the dashboard.
            device.findObject(By.text("Transactions"))?.click()
            device.waitForIdle()
            device.findObject(By.text("Dashboard"))?.click()
            device.waitForIdle()
        }
    }
}
