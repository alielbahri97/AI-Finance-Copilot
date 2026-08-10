package com.ballastmoney.android.data.remote

/**
 * Every endpoint and query-parameter name the client uses, in one place, so a
 * route rename is a single edit and no call site invents a spelling.
 *
 * These are transcribed from `MOBILE_API.md`, which is the frozen wire
 * contract, not guessed from the route folder names.
 */
object ApiRoutes {
    const val SESSION_BOOTSTRAP = "api/session/bootstrap"
    const val DASHBOARD = "api/dashboard"
    const val TRANSACTIONS = "api/transactions"
    const val INTEGRATIONS = "api/integrations"
    const val PROFILE = "api/profile"
    const val WORKSPACE = "api/workspace"
    const val BILLING_SUMMARY = "api/billing/summary"

    const val GOCARDLESS_INSTITUTIONS = "api/integrations/gocardless/institutions"
    const val GOCARDLESS_LINK = "api/integrations/gocardless/link"
    const val GOCARDLESS_FINALIZE = "api/integrations/gocardless/finalize"

    fun providerSync(provider: String): String = "api/integrations/$provider/sync"

    /** Headers the API reads. */
    object Headers {
        /**
         * Workspace *hint*. It grants nothing: the server sanitises it, uses it
         * only to look up a membership row, and re-verifies that membership on
         * every request. Naming a workspace you are not in selects nothing and
         * falls through to your default rather than erroring.
         */
        const val WORKSPACE = "X-Ballast-Workspace"
    }

    /**
     * Query parameter names for `GET /api/transactions`.
     *
     * `SIZE` is `size`, not `pageSize` — this was previously spelled the other
     * way here, which the contract does not accept, and it would have silently
     * fallen back to the default of 50 on every request.
     */
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
        const val SIZE = "size"
    }
}
