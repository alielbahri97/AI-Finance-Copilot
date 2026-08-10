package com.ballastmoney.android.ui.dashboard

import com.ballastmoney.android.core.common.MoneyFormatter
import com.ballastmoney.android.core.model.DashboardSnapshot
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.PlanLimits
import com.ballastmoney.android.core.model.WorkspaceType

/**
 * Everything the dashboard renders, in one value.
 *
 * The screen reads nothing else: no repository, no session, no `LocalContext`
 * lookups for copy. That is what makes every composable below
 * [DashboardScreen] a pure function of its arguments, and therefore previewable
 * without Hilt and testable without a device.
 *
 * The three states are deliberately not a single class with nullable fields.
 * "Loading" and "failed with nothing cached" are different screens, and a
 * `Ready` value that cannot exist without a snapshot removes the whole class of
 * null checks from the composables.
 */
sealed interface DashboardUiState {

    /** First load, before the cache has produced anything. Renders skeletons. */
    data object Loading : DashboardUiState

    /**
     * A refresh failed *and* there was nothing cached to fall back on. A
     * failure with data on screen never reaches this state — see
     * [Ready.isRefreshing].
     */
    data class Error(val message: String) : DashboardUiState

    data class Ready(
        val edition: WorkspaceType,
        val greeting: String,
        val subtitle: String,
        val snapshot: DashboardSnapshot,
        val formatter: MoneyFormatter,
        val permissions: Set<Permission>,
        val limits: PlanLimits,
        /**
         * A refresh is in flight over data that is already on screen. The
         * header shows it; the body does not flicker back to skeletons.
         */
        val isRefreshing: Boolean = false,
    ) : DashboardUiState {

        fun can(permission: Permission): Boolean = permission in permissions

        /**
         * Which permission gates the analytical cards.
         *
         * This asymmetry is copied from the web app rather than tidied up: the
         * Business dashboard's charts are gated on `view_transactions` while
         * the Personal dashboard's are gated on `view_reports`. It reads like
         * an oversight, but the web app is the source of truth for what a
         * VIEWER can see, and diverging would mean the two clients disagree
         * about a permission boundary. Flagged for the product owner instead.
         */
        val chartPermission: Permission
            get() = when (edition) {
                WorkspaceType.BUSINESS -> Permission.VIEW_TRANSACTIONS
                WorkspaceType.PERSONAL -> Permission.VIEW_REPORTS
            }

        val canSeeCharts: Boolean get() = can(chartPermission)
    }
}
