package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.designsystem.brand.BallastLogo
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * The screen app bar.
 *
 * The container is transparent so the bar sits on whatever the screen's
 * background is — the web header has no fill of its own, and the app draws
 * edge-to-edge, so an opaque bar would put a seam under the status bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BallastTopBar(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    navigationIcon: @Composable (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = {
            Column {
                Text(
                    text = title,
                    style = BallastTextStyles.sectionTitle,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.ballastColors.mutedForeground,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
        modifier = modifier,
        navigationIcon = { navigationIcon?.invoke() },
        actions = actions,
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = Color.Transparent,
            scrolledContainerColor = Color.Transparent,
            navigationIconContentColor = MaterialTheme.colorScheme.onBackground,
            titleContentColor = MaterialTheme.colorScheme.onBackground,
            actionIconContentColor = MaterialTheme.colorScheme.onBackground,
        ),
    )
}

// --- Previews --------------------------------------------------------------

@Composable
private fun TopBarGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column {
            BallastTopBar(
                title = "Dashboard",
                navigationIcon = {
                    BallastLogo(modifier = Modifier.padding(start = BallastSpacing.lg))
                },
                actions = {
                    BallastIconButton(
                        icon = Icons.Filled.Notifications,
                        contentDescription = "Notifications, 3 unread",
                        onClick = {},
                        badgeCount = 3,
                    )
                    BallastIconButton(
                        icon = Icons.Filled.MoreVert,
                        contentDescription = "More",
                        onClick = {},
                    )
                },
            )
            BallastSeparator()
            BallastTopBar(
                title = "Transactions",
                subtitle = "1,284 this month · Acme Ltd",
                actions = {
                    BallastAvatar(initials = "AE", size = 28.dp)
                },
            )
        }
    }
}

@Preview(name = "Top bar light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun TopBarLightPreview() {
    BallastTheme(darkTheme = false) { TopBarGallery() }
}

@Preview(name = "Top bar dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun TopBarDarkPreview() {
    BallastTheme(darkTheme = true) { TopBarGallery() }
}
