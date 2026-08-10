package com.ballastmoney.android.data.remote

/**
 * The endpoints the parallel API work is building. Listed in one place so the
 * network implementations that replace the fakes have nothing to guess at, and
 * so a route rename is a single edit.
 */
object ApiRoutes {
    const val SESSION_BOOTSTRAP = "api/session/bootstrap"
    const val DASHBOARD = "api/dashboard"
    const val TRANSACTIONS = "api/transactions"
    const val INTEGRATIONS = "api/integrations"
    const val PROFILE = "api/profile"
    const val WORKSPACE = "api/workspace"
    const val BILLING_SUMMARY = "api/billing/summary"

    /** Query parameter names, matching the web app's `searchParams` contract. */
    object Params {
        const val SEARCH = "q"
        const val TYPE = "type"
        const val CATEGORY = "category"
        const val IMPORT_BATCH = "batch"
        const val FROM = "from"
        const val TO = "to"
        const val MIN_AMOUNT = "min"
        const val MAX_AMOUNT = "max"
        const val SORT = "sort"
        const val DIRECTION = "dir"
        const val PAGE = "page"
        const val PAGE_SIZE = "pageSize"
        const val WORKSPACE_ID = "workspaceId"
    }
}
