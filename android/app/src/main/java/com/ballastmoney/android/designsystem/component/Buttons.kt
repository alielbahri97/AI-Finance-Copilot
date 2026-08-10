package com.ballastmoney.android.designsystem.component

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.Pill
import com.ballastmoney.android.designsystem.theme.ballastColors

enum class ButtonVariant { PRIMARY, SECONDARY, OUTLINE, GHOST, DESTRUCTIVE, LINK }

enum class ButtonSize { SMALL, DEFAULT, LARGE }

/**
 * `rounded-xl` on the web, which the shadcn scale derives as `--radius + 4px` and
 * therefore 16dp rather than the 12dp `--radius` itself suggests. The small size
 * is the exception: it asks for `rounded-lg`, the bare token.
 */
private fun ButtonSize.shape() = when (this) {
    ButtonSize.SMALL -> RoundedCornerShape(BallastRadius.lg)
    ButtonSize.DEFAULT, ButtonSize.LARGE -> RoundedCornerShape(BallastRadius.xl)
}

private class ButtonPalette(
    val container: Color,
    val content: Color,
    val border: Color?,
)

@Composable
private fun paletteFor(variant: ButtonVariant): ButtonPalette {
    val scheme = MaterialTheme.colorScheme
    val extended = MaterialTheme.ballastColors
    return when (variant) {
        ButtonVariant.PRIMARY -> ButtonPalette(scheme.primary, scheme.onPrimary, null)
        ButtonVariant.SECONDARY -> ButtonPalette(scheme.secondary, scheme.onSecondary, null)
        ButtonVariant.OUTLINE -> ButtonPalette(Color.Transparent, scheme.onBackground, scheme.outline)
        ButtonVariant.GHOST -> ButtonPalette(Color.Transparent, scheme.onBackground, null)
        // A filled destructive surface takes the solid token, not the base one:
        // white on the base measures 2.89:1 in dark mode.
        ButtonVariant.DESTRUCTIVE -> ButtonPalette(extended.destructiveSolid, Color.White, null)
        ButtonVariant.LINK -> ButtonPalette(Color.Transparent, scheme.primary, null)
    }
}

private fun ButtonSize.height() = when (this) {
    ButtonSize.SMALL -> 32.dp
    ButtonSize.DEFAULT -> 36.dp
    ButtonSize.LARGE -> 40.dp
}

private fun ButtonSize.horizontalPadding() = when (this) {
    ButtonSize.SMALL -> 12.dp
    ButtonSize.DEFAULT -> 16.dp
    ButtonSize.LARGE -> 24.dp
}

/**
 * The one button in the app.
 *
 * [loading] both swaps the leading icon for a spinner and blocks the click, so a
 * caller cannot forget to disable a submitting button.
 */
@Composable
fun BallastButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.PRIMARY,
    size: ButtonSize = ButtonSize.DEFAULT,
    enabled: Boolean = true,
    loading: Boolean = false,
    leadingIcon: ImageVector? = null,
    fillMaxWidth: Boolean = false,
) {
    val palette = paletteFor(variant)
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    // `active:scale-[0.98]` on the web. A link is text, so it does not squash.
    val pressScale by animateFloatAsState(
        targetValue = if (pressed && variant != ButtonVariant.LINK) 0.98f else 1f,
        animationSpec = tween(durationMillis = 120),
        label = "buttonPressScale",
    )

    val horizontalPadding = if (variant == ButtonVariant.LINK) {
        BallastSpacing.xs
    } else {
        size.horizontalPadding()
    }

    Button(
        onClick = onClick,
        modifier = modifier
            .then(if (fillMaxWidth) Modifier.fillMaxWidth() else Modifier)
            .height(size.height())
            .scale(pressScale),
        enabled = enabled && !loading,
        shape = size.shape(),
        colors = ButtonDefaults.buttonColors(
            containerColor = palette.container,
            contentColor = palette.content,
            // `disabled:opacity-50`.
            disabledContainerColor = palette.container.copy(alpha = palette.container.alpha * 0.5f),
            disabledContentColor = palette.content.copy(alpha = 0.5f),
        ),
        // The web card and button family is flat with at most a hairline shadow;
        // Material's default elevation reads as a different product.
        elevation = null,
        border = palette.border?.let { BorderStroke(1.dp, it) },
        contentPadding = PaddingValues(horizontal = horizontalPadding, vertical = 0.dp),
        interactionSource = interactionSource,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
        ) {
            when {
                loading -> CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    color = palette.content,
                    strokeWidth = 2.dp,
                )
                leadingIcon != null -> Icon(
                    imageVector = leadingIcon,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
            }
            Text(
                text = text,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * An icon-only action, optionally carrying a count.
 *
 * [badgeCount] exists for the notification bell; anything past nine collapses to
 * "9+" so the badge stays circular.
 */
@Composable
fun BallastIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    badgeCount: Int = 0,
) {
    Box(modifier = modifier) {
        IconButton(
            onClick = onClick,
            enabled = enabled,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                modifier = Modifier.size(20.dp),
                tint = if (enabled) {
                    MaterialTheme.colorScheme.onBackground
                } else {
                    MaterialTheme.ballastColors.mutedForeground.copy(alpha = 0.5f)
                },
            )
        }
        if (badgeCount > 0) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = (-2).dp, y = 2.dp)
                    .defaultMinSize(minWidth = 16.dp, minHeight = 16.dp)
                    .background(MaterialTheme.ballastColors.destructiveSolid, Pill)
                    .padding(horizontal = BallastSpacing.xs),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (badgeCount > 9) "9+" else badgeCount.toString(),
                    style = BallastTextStyles.micro.copy(fontSize = 10.sp),
                    color = Color.White,
                    maxLines = 1,
                )
            }
        }
    }
}

// --- Previews --------------------------------------------------------------

@Composable
private fun ButtonGallery() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(BallastSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                BallastButton(text = "Primary", onClick = {})
                BallastButton(text = "Secondary", onClick = {}, variant = ButtonVariant.SECONDARY)
                BallastButton(text = "Outline", onClick = {}, variant = ButtonVariant.OUTLINE)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                BallastButton(text = "Ghost", onClick = {}, variant = ButtonVariant.GHOST)
                BallastButton(
                    text = "Delete",
                    onClick = {},
                    variant = ButtonVariant.DESTRUCTIVE,
                    leadingIcon = Icons.Filled.Delete,
                )
                BallastButton(text = "Learn more", onClick = {}, variant = ButtonVariant.LINK)
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BallastButton(text = "Small", onClick = {}, size = ButtonSize.SMALL)
                BallastButton(text = "Default", onClick = {}, size = ButtonSize.DEFAULT)
                BallastButton(text = "Large", onClick = {}, size = ButtonSize.LARGE)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                BallastButton(text = "Saving", onClick = {}, loading = true)
                BallastButton(text = "Disabled", onClick = {}, enabled = false)
            }
            BallastButton(
                text = "Add transaction",
                onClick = {},
                leadingIcon = Icons.Filled.Add,
                fillMaxWidth = true,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(BallastSpacing.sm)) {
                BallastIconButton(
                    icon = Icons.Filled.Notifications,
                    contentDescription = "Notifications",
                    onClick = {},
                )
                BallastIconButton(
                    icon = Icons.Filled.Notifications,
                    contentDescription = "Notifications, 3 unread",
                    onClick = {},
                    badgeCount = 3,
                )
                BallastIconButton(
                    icon = Icons.Filled.Notifications,
                    contentDescription = "Notifications, 12 unread",
                    onClick = {},
                    badgeCount = 12,
                )
            }
        }
    }
}

@Preview(name = "Buttons light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun ButtonsLightPreview() {
    BallastTheme(darkTheme = false) { ButtonGallery() }
}

@Preview(name = "Buttons dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun ButtonsDarkPreview() {
    BallastTheme(darkTheme = true) { ButtonGallery() }
}
