package com.ballastmoney.android.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * The sheet every "pick one" and "edit this" flow uses on a phone.
 *
 * `ModalBottomSheet` already insets its own content for the navigation bar, so
 * the padding here is spacing only.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BallastBottomSheet(
    onDismissRequest: () -> Unit,
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        modifier = modifier,
        sheetState = sheetState,
        shape = RoundedCornerShape(topStart = BallastRadius.xl, topEnd = BallastRadius.xl),
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        dragHandle = { BottomSheetDefaults.DragHandle() },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    start = BallastSpacing.lg,
                    end = BallastSpacing.lg,
                    bottom = BallastSpacing.xl,
                ),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            Text(
                text = title,
                style = BallastTextStyles.sectionTitle,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (description != null) {
                Text(
                    text = description,
                    style = BallastTextStyles.mutedBody,
                    color = MaterialTheme.ballastColors.mutedForeground,
                )
            }
            content()
        }
    }
}

/*
 * No `@Preview` here: `ModalBottomSheet` renders into its own window through a
 * dialog, which the preview renderer does not host, so a preview of it comes out
 * blank. The sheet's body is previewed through the components it contains.
 */
