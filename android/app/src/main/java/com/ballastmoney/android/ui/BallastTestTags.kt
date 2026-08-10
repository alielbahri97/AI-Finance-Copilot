package com.ballastmoney.android.ui

/**
 * Test tags for the handful of nodes a test has to find structurally rather than
 * by what they say.
 *
 * Kept to scrollable containers on purpose. A test that looks for a button by its
 * label fails when the label becomes wrong, which is the failure worth having; a
 * test that looks for `add-transaction-button` passes while the button reads
 * "Delete". But a lazy list only composes what is on screen, so reaching an
 * off-screen row means asking the list to scroll, and that needs a handle on the
 * list itself.
 */
object BallastTestTags {
    const val DASHBOARD_LIST = "dashboard-list"
    const val TRANSACTIONS_LIST = "transactions-list"
    const val ACCOUNTS_LIST = "accounts-list"
}
