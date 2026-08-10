package com.ballastmoney.android.navigation

import kotlinx.serialization.Serializable

/**
 * Type-safe navigation routes.
 *
 * Compose Navigation serialises these with kotlinx.serialization, so a
 * destination is an ordinary Kotlin value rather than a string template with
 * hand-parsed arguments. The R8 keep rule for this package exists because the
 * library reflects over these classes to build and read argument bundles.
 */
sealed interface Route {
    /**
     * The equivalent web URL. It is the identity a [NavItem] is matched on, so
     * the bottom bar can tell which tab is selected without a second lookup
     * table, and it keeps the two clients' navigation comparable by eye.
     */
    val webPath: String
}

@Serializable
data object DashboardRoute : Route {
    override val webPath: String get() = "/dashboard"
}

@Serializable
data object TransactionsRoute : Route {
    override val webPath: String get() = "/transactions"
}

/**
 * Banks and accounts. On the web this lives at `/integrations` and covers every
 * provider category; on mobile the first release only surfaces the banking
 * providers and their accounts, hence the name.
 */
@Serializable
data object AccountsRoute : Route {
    override val webPath: String get() = "/integrations"
}

/**
 * A destination that exists in the product but not yet in this client. Carries
 * the web path so the placeholder can name what it will become and, later, so
 * the same route can be swapped for a real screen without touching callers.
 */
@Serializable
data class ComingSoonRoute(
    override val webPath: String,
    val title: String,
) : Route

/**
 * The session lock. Presented as a full-screen destination on top of the
 * navigation graph rather than as a dialog, so the back stack underneath is
 * preserved and nothing behind it can be reached or read.
 */
@Serializable
data object SessionLockRoute : Route {
    /** Not a web destination; the browser has its own lock overlay. */
    override val webPath: String get() = "/lock"
}
