package com.ballastmoney.android.core.model

/**
 * Edition rules, ported from `src/lib/workspace/editions.ts`.
 *
 * This is the single place the client is allowed to decide "does this edition
 * have this feature". The web app's own comment is worth repeating: the server
 * guards every route as well, so agreeing with it here is a convenience, not
 * the security boundary. The point of keeping the tables identical is that the
 * client never *offers* something the server will refuse.
 */
object Editions {

    val featuresFor: Map<WorkspaceType, Set<EditionFeature>> = mapOf(
        WorkspaceType.BUSINESS to setOf(
            EditionFeature.INVOICES,
            EditionFeature.COUNTERPARTIES,
            EditionFeature.TEAM,
            EditionFeature.ACCOUNTING,
        ),
        WorkspaceType.PERSONAL to setOf(
            EditionFeature.BUDGETS,
            EditionFeature.GOALS,
            EditionFeature.NET_WORTH,
            EditionFeature.SUBSCRIPTIONS,
        ),
    )

    fun hasFeature(type: WorkspaceType, feature: EditionFeature): Boolean =
        feature in featuresFor.getValue(type)

    /**
     * Permissions a workspace of this edition can never hold, regardless of
     * role. A Personal workspace has no invoices and no team, so even an OWNER
     * comes back from the server without these.
     */
    private val strippedByEdition: Map<WorkspaceType, Set<Permission>> = mapOf(
        WorkspaceType.BUSINESS to emptySet(),
        WorkspaceType.PERSONAL to setOf(
            Permission.VIEW_INVOICES,
            Permission.EDIT_INVOICES,
            Permission.MANAGE_MEMBERS,
        ),
    )

    fun applyEditionPermissions(
        type: WorkspaceType,
        permissions: Set<Permission>,
    ): Set<Permission> = permissions - strippedByEdition.getValue(type)
}

/**
 * Role defaults from `src/lib/workspace/permissions.ts`. Per-member overrides
 * are applied server-side, so the client only needs these to reason about what
 * a role can do in the abstract (used by tests and by the fake session).
 */
object RolePermissions {

    private val viewer: Set<Permission> = setOf(
        Permission.VIEW_TRANSACTIONS,
        Permission.VIEW_INVOICES,
        Permission.VIEW_REPORTS,
    )

    private val member: Set<Permission> = viewer + setOf(
        Permission.EDIT_TRANSACTIONS,
        Permission.EDIT_INVOICES,
        Permission.EXPORT_DATA,
        Permission.USE_COPILOT,
        Permission.MANAGE_FORECAST,
    )

    val defaults: Map<WorkspaceRole, Set<Permission>> = mapOf(
        WorkspaceRole.OWNER to Permission.entries.toSet(),
        WorkspaceRole.ADMIN to Permission.entries.toSet(),
        WorkspaceRole.MEMBER to member,
        WorkspaceRole.VIEWER to viewer,
    )

    fun forRole(role: WorkspaceRole): Set<Permission> = defaults.getValue(role)
}
