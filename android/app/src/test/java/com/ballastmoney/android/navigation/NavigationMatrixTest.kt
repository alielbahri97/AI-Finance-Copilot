package com.ballastmoney.android.navigation

import com.ballastmoney.android.core.model.Editions
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.RolePermissions
import com.ballastmoney.android.core.model.WorkspaceRole
import com.ballastmoney.android.core.model.WorkspaceType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory

/**
 * The invariant this file exists for: **navigation never offers a destination the
 * server would refuse.**
 *
 * The web suite asserts the edition half of this. On the web a wrongly-offered
 * link costs a redirect the user barely notices; in a bottom navigation bar it is
 * a tab that bounces you back, so the Android table also carries the permission
 * each page checks and this test covers every edition and role combination rather
 * than a couple of examples.
 */
class NavigationMatrixTest {

    /**
     * Every (edition, role) pair the product can produce, with permissions
     * resolved exactly as the server resolves them: role defaults first, then the
     * edition narrowing.
     */
    private val matrix: List<Triple<WorkspaceType, WorkspaceRole, Set<Permission>>> =
        WorkspaceType.entries.flatMap { type ->
            WorkspaceRole.entries.map { role ->
                Triple(type, role, Editions.applyEditionPermissions(type, RolePermissions.forRole(role)))
            }
        }

    @TestFactory
    @DisplayName("no offered destination is blocked by edition or permission")
    fun everyOfferedDestinationIsAllowed(): List<DynamicTest> = matrix.map { (type, role, permissions) ->
        DynamicTest.dynamicTest("$type / $role") {
            val offered = NavItems.navItemsFor(type, permissions, isAdmin = false) +
                NavItems.tabBarItemsFor(type, permissions) +
                NavItems.moreItemsFor(type, permissions, isAdmin = false).flatMap { it.second }

            offered.forEach { item ->
                item.feature?.let { feature ->
                    assertTrue(
                        Editions.hasFeature(type, feature),
                        "$type offered ${item.webPath}, which needs the $feature feature",
                    )
                }
                item.permission?.let { permission ->
                    assertTrue(
                        permission in permissions,
                        "$type / $role offered ${item.webPath}, which needs $permission",
                    )
                }
                assertFalse(
                    item.adminOnly,
                    "a non-admin was offered ${item.webPath}",
                )
            }
        }
    }

    @TestFactory
    @DisplayName("the bottom bar is a subset of the allowed destinations")
    fun tabsAreAlwaysReachable(): List<DynamicTest> = matrix.map { (type, role, permissions) ->
        DynamicTest.dynamicTest("$type / $role") {
            val allowed = NavItems.navItemsFor(type, permissions).map { it.webPath }.toSet()
            val tabs = NavItems.tabBarItemsFor(type, permissions).map { it.webPath }
            assertTrue(
                allowed.containsAll(tabs),
                "$type / $role tabs $tabs are not all in the allowed set",
            )
        }
    }

    @TestFactory
    @DisplayName("the more sheet and the bottom bar never duplicate a destination")
    fun moreSheetExcludesTabs(): List<DynamicTest> = matrix.map { (type, role, permissions) ->
        DynamicTest.dynamicTest("$type / $role") {
            val tabs = NavItems.tabBarItemsFor(type, permissions).map { it.webPath }.toSet()
            val more = NavItems.moreItemsFor(type, permissions).flatMap { it.second }.map { it.webPath }
            assertTrue(
                more.none { it in tabs },
                "$type / $role lists ${more.filter { it in tabs }} in both places",
            )
        }
    }

    @Test
    @DisplayName("Personal never offers invoices, and Business never offers budgets or goals")
    fun editionsHideEachOthersFeatures() {
        val personal = NavItems.navItemsFor(
            WorkspaceType.PERSONAL,
            Editions.applyEditionPermissions(
                WorkspaceType.PERSONAL,
                RolePermissions.forRole(WorkspaceRole.OWNER),
            ),
        ).map { it.webPath }
        val business = NavItems.navItemsFor(
            WorkspaceType.BUSINESS,
            RolePermissions.forRole(WorkspaceRole.OWNER),
        ).map { it.webPath }

        assertFalse("/invoices" in personal, "Personal offered /invoices")
        assertTrue("/budgets" in personal)
        assertTrue("/goals" in personal)
        assertTrue("/net-worth" in personal)

        assertTrue("/invoices" in business)
        assertFalse("/budgets" in business, "Business offered /budgets")
        assertFalse("/goals" in business, "Business offered /goals")
    }

    @Test
    @DisplayName("a viewer gets no destination that needs an editing permission")
    fun viewerCannotSeeEditingDestinations() {
        val permissions = Editions.applyEditionPermissions(
            WorkspaceType.BUSINESS,
            RolePermissions.forRole(WorkspaceRole.VIEWER),
        )
        val offered = NavItems.navItemsFor(WorkspaceType.BUSINESS, permissions).map { it.webPath }

        // Import needs edit_transactions, banks need manage_integrations, billing
        // needs view_billing — a viewer has none of the three.
        assertFalse("/import" in offered)
        assertFalse("/integrations" in offered)
        assertFalse("/billing" in offered)
        assertTrue("/transactions" in offered)
        assertTrue("/dashboard" in offered)
    }

    @Test
    @DisplayName("a viewer's bottom bar drops the banks tab rather than showing a dead one")
    fun viewerTabBarShrinks() {
        val permissions = Editions.applyEditionPermissions(
            WorkspaceType.BUSINESS,
            RolePermissions.forRole(WorkspaceRole.VIEWER),
        )
        val tabs = NavItems.tabBarItemsFor(WorkspaceType.BUSINESS, permissions).map { it.webPath }
        assertEquals(listOf("/dashboard", "/transactions"), tabs)
    }

    @Test
    @DisplayName("admin appears only for admin profiles")
    fun adminIsGated() {
        val permissions = RolePermissions.forRole(WorkspaceRole.OWNER)
        val withoutAdmin = NavItems.navItemsFor(WorkspaceType.BUSINESS, permissions, isAdmin = false)
        val withAdmin = NavItems.navItemsFor(WorkspaceType.BUSINESS, permissions, isAdmin = true)

        assertFalse(withoutAdmin.any { it.webPath == "/admin" })
        assertTrue(withAdmin.any { it.webPath == "/admin" })
    }

    @Test
    @DisplayName("every destination in the table is either built or resolves to a placeholder")
    fun everyItemHasADestination() {
        (NavItems.all + NavItems.adminItem).forEach { item ->
            val route = item.routeOrPlaceholder()
            assertEquals(
                item.webPath,
                route.webPath,
                "${item.webPath} routes to a destination that reports a different web path",
            )
        }
    }

    @Test
    @DisplayName("the substituted third tab is deliberate, not drift")
    fun tabSubstitutionIsRecorded() {
        // The web app's third tab is /copilot for Business and /budgets for
        // Personal; neither screen exists in this release. If someone builds
        // either one, this test fails and the substitution gets revisited on
        // purpose rather than being forgotten.
        assertEquals(
            listOf("/dashboard", "/transactions", "/copilot"),
            NavItems.webTabBarPaths.getValue(WorkspaceType.BUSINESS),
        )
        assertEquals(
            listOf("/dashboard", "/transactions", "/budgets"),
            NavItems.webTabBarPaths.getValue(WorkspaceType.PERSONAL),
        )

        val ownerBusiness = NavItems.tabBarItemsFor(
            WorkspaceType.BUSINESS,
            RolePermissions.forRole(WorkspaceRole.OWNER),
        ).map { it.webPath }
        assertEquals(listOf("/dashboard", "/transactions", "/integrations"), ownerBusiness)

        val substituted = NavItems.all.filter { it.webPath == "/copilot" || it.webPath == "/budgets" }
        assertTrue(
            substituted.none { it.isBuilt },
            "a substituted tab now has a real screen, so the bottom bar should use it",
        )
    }
}
