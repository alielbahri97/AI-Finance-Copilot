package com.ballastmoney.android.ui.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.model.WorkspaceSummary
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.designsystem.brand.BallastLogo
import com.ballastmoney.android.designsystem.component.BallastBadge
import com.ballastmoney.android.designsystem.component.BadgeVariant
import com.ballastmoney.android.designsystem.component.BallastIconButton
import com.ballastmoney.android.designsystem.component.BallastListRow
import com.ballastmoney.android.designsystem.component.BallastSeparator
import com.ballastmoney.android.designsystem.component.BallastTopBar
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors
import com.ballastmoney.android.navigation.NavItem
import com.ballastmoney.android.navigation.NavSection

/**
 * The app bar: brand, which workspace you are in, and notifications.
 *
 * Separate from each screen's own page header, the same way the web app has a
 * header above a page title. The workspace name is the title because on a phone
 * the question "which set of books am I looking at" has no other answer, and
 * getting that wrong in a product holding both a business and a personal ledger
 * is the expensive mistake.
 */
@Composable
fun ShellTopBar(
    workspaceName: String,
    edition: WorkspaceType,
    unreadNotifications: Int,
    canSwitchWorkspace: Boolean,
    onSwitchWorkspace: () -> Unit,
    onOpenNotifications: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BallastTopBar(
        title = workspaceName,
        modifier = modifier,
        subtitle = when (edition) {
            WorkspaceType.BUSINESS -> "Business"
            WorkspaceType.PERSONAL -> "Personal"
        },
        navigationIcon = {
            BallastLogo(
                modifier = Modifier.padding(start = BallastSpacing.lg),
                size = 24.dp,
            )
        },
        actions = {
            if (canSwitchWorkspace) {
                BallastIconButton(
                    icon = Icons.Outlined.UnfoldMore,
                    contentDescription = "Switch workspace",
                    onClick = onSwitchWorkspace,
                )
            }
            BallastIconButton(
                icon = Icons.Outlined.NotificationsNone,
                contentDescription = if (unreadNotifications > 0) {
                    "Notifications, $unreadNotifications unread"
                } else {
                    "Notifications"
                },
                onClick = onOpenNotifications,
                badgeCount = unreadNotifications,
                modifier = Modifier.padding(end = BallastSpacing.sm),
            )
        },
    )
}

/**
 * The bottom bar: the edition's tabs plus a "More" entry for everything else.
 *
 * [items] has already been filtered by edition and permission, so this composable
 * cannot render a destination the server would refuse — the filtering is not
 * repeated here precisely so there is one place to get it right.
 */
@Composable
fun BallastBottomBar(
    items: List<NavItem>,
    selectedWebPath: String?,
    onSelect: (NavItem) -> Unit,
    onOpenMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    NavigationBar(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
    ) {
        items.forEach { item ->
            val selected = item.webPath == selectedWebPath
            NavigationBarItem(
                selected = selected,
                onClick = { onSelect(item) },
                icon = {
                    Icon(
                        imageVector = item.icon,
                        contentDescription = null,
                        modifier = Modifier.size(22.dp),
                    )
                },
                label = { Text(item.title, maxLines = 1) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    selectedTextColor = MaterialTheme.colorScheme.primary,
                    indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                    unselectedIconColor = MaterialTheme.ballastColors.mutedForeground,
                    unselectedTextColor = MaterialTheme.ballastColors.mutedForeground,
                ),
            )
        }
        NavigationBarItem(
            selected = false,
            onClick = onOpenMore,
            icon = {
                Icon(
                    imageVector = Icons.Outlined.MoreHoriz,
                    contentDescription = null,
                    modifier = Modifier.size(22.dp),
                )
            },
            label = { Text("More", maxLines = 1) },
            colors = NavigationBarItemDefaults.colors(
                unselectedIconColor = MaterialTheme.ballastColors.mutedForeground,
                unselectedTextColor = MaterialTheme.ballastColors.mutedForeground,
            ),
        )
    }
}

/**
 * Contents of the "more" sheet: every remaining destination, grouped exactly as
 * the web sidebar groups them.
 *
 * Destinations this release has not built are still listed, marked "Soon" and
 * still tappable. Hiding them would make the app look like it has fewer features
 * than the product does; a placeholder that names the screen is more honest than
 * a gap, and it keeps the navigation matrix complete for the test.
 */
@Composable
fun MoreSheetContent(
    sections: List<Pair<NavSection, List<NavItem>>>,
    onSelect: (NavItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    // A plain scrolling Column rather than a LazyColumn: there are at most
    // fifteen rows, and a lazy list inside a bottom sheet has to fight the
    // sheet's own scrolling for the same gesture.
    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
    ) {
        sections.forEachIndexed { index, (section, items) ->
            if (index > 0) BallastSeparator(modifier = Modifier.padding(vertical = BallastSpacing.sm))
            Text(
                text = section.label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.ballastColors.mutedForeground,
                modifier = Modifier.padding(
                    top = BallastSpacing.sm,
                    bottom = BallastSpacing.xs,
                ),
            )
            items.forEach { item ->
                BallastListRow(
                    title = item.title,
                    onClick = { onSelect(item) },
                    leading = {
                        Icon(
                            imageVector = item.icon,
                            contentDescription = null,
                            tint = MaterialTheme.ballastColors.mutedForeground,
                            modifier = Modifier.size(20.dp),
                        )
                    },
                    trailing = {
                        if (!item.isBuilt) {
                            BallastBadge(text = "Soon", variant = BadgeVariant.SECONDARY)
                        }
                    },
                )
            }
        }
    }
}

/**
 * Workspace switcher. Only opened when the user belongs to more than one
 * workspace, because a list of one is a dead end.
 */
@Composable
fun WorkspaceSwitcherContent(
    workspaces: List<WorkspaceSummary>,
    currentWorkspaceId: String,
    onSelect: (WorkspaceSummary) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        workspaces.forEach { workspace ->
            val current = workspace.id == currentWorkspaceId
            BallastListRow(
                title = workspace.name,
                onClick = { onSelect(workspace) },
                subtitle = when (workspace.type) {
                    WorkspaceType.BUSINESS -> "Business"
                    WorkspaceType.PERSONAL -> "Personal"
                },
                trailing = {
                    if (current) {
                        Icon(
                            imageVector = Icons.Outlined.Check,
                            contentDescription = "Current workspace",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                },
            )
        }
    }
}

/** Placeholder for the destinations this release does not include. */
@Composable
fun ComingSoonScreen(
    title: String,
    webPath: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier.padding(BallastSpacing.xl),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        ) {
            Text(
                text = title,
                style = BallastTextStyles.pageTitle,
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "This screen is part of Ballast on the web at $webPath and is not in " +
                    "the Android app yet. The first release covers your dashboard, " +
                    "transactions, and banks and accounts.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.ballastColors.mutedForeground,
            )
        }
    }
}
