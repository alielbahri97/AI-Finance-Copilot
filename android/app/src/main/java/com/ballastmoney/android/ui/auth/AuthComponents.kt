package com.ballastmoney.android.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.designsystem.brand.BallastLogo
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastCard
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.theme.BallastRadius
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * The frame every auth screen sits in: logo, title, supporting line, and a card
 * holding the form.
 *
 * The web wraps each of these pages in the same `Card` inside the `(auth)`
 * layout, and the phone gets the same shape rather than a bare full-bleed form
 * — the card is what stops a three-field form floating in the middle of a large
 * display with nothing to anchor it.
 *
 * It scrolls. A soft keyboard over a signup form leaves roughly a third of a
 * handset visible, and `adjustResize` in the manifest only helps if there is
 * something to resize into.
 */
@Composable
fun AuthScaffold(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    eyebrow: String? = null,
    footer: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val insets = WindowInsets.safeDrawing.asPaddingValues()
    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(insets)
                .padding(horizontal = BallastSpacing.lg, vertical = BallastSpacing.xl),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(BallastSpacing.lg),
        ) {
            BallastLogo(size = 32.dp, showWordmark = true)

            Column(
                modifier = Modifier.widthIn(max = FormMaxWidth),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
            ) {
                if (eyebrow != null) {
                    Text(
                        text = eyebrow,
                        style = BallastTextStyles.sectionLabel,
                        color = MaterialTheme.colorScheme.primary,
                        textAlign = TextAlign.Center,
                    )
                }
                Text(
                    text = title,
                    style = BallastTextStyles.sectionTitle,
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center,
                )
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        style = BallastTextStyles.mutedBody,
                        color = MaterialTheme.ballastColors.mutedForeground,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            BallastCard(modifier = Modifier.widthIn(max = FormMaxWidth)) {
                Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.lg)) {
                    content()
                }
            }

            if (footer != null) {
                Column(
                    modifier = Modifier.widthIn(max = FormMaxWidth),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
                ) {
                    footer()
                }
            }
        }
    }
}

/**
 * A password field.
 *
 * `BallastTextField` in the design system takes no `visualTransformation`, and
 * `designsystem/` is owned elsewhere, so this reproduces its border, height,
 * radius and label treatment locally rather than a component being changed
 * underneath another team. If a masked variant is ever added there, this should
 * be deleted in favour of it — the styling here is a copy, and copies drift.
 *
 * The reveal toggle defaults to hidden and is a plain clickable icon rather
 * than an `IconButton`, for the reason `BallastSearchField` gives: an
 * `IconButton` claims a 48dp target that a 36dp field cannot host.
 */
@Composable
fun AuthPasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    errorMessage: String? = null,
    enabled: Boolean = true,
    imeAction: ImeAction = ImeAction.Next,
    onImeAction: (() -> Unit)? = null,
) {
    var revealed by rememberSaveable { mutableStateOf(false) }
    val scheme = MaterialTheme.colorScheme
    val extended = MaterialTheme.ballastColors
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val isError = errorMessage != null

    val borderColor = when {
        isError -> scheme.error
        focused -> scheme.primary
        !enabled -> scheme.outline.copy(alpha = DISABLED_ALPHA)
        else -> scheme.outline
    }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = if (isError) scheme.error else scheme.onBackground,
        )

        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            enabled = enabled,
            textStyle = MaterialTheme.typography.bodyMedium.copy(
                color = if (enabled) scheme.onSurface else extended.mutedForeground,
            ),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = imeAction,
            ),
            keyboardActions = KeyboardActions(
                onDone = { onImeAction?.invoke() },
                onGo = { onImeAction?.invoke() },
            ),
            singleLine = true,
            maxLines = 1,
            interactionSource = interactionSource,
            cursorBrush = SolidColor(if (isError) scheme.error else scheme.primary),
            visualTransformation = if (revealed) {
                VisualTransformation.None
            } else {
                PasswordVisualTransformation()
            },
        ) { innerTextField ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FieldMinHeight)
                    .border(1.dp, borderColor, FieldShape)
                    .background(Color.Transparent, FieldShape)
                    .padding(horizontal = BallastSpacing.md, vertical = BallastSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(modifier = Modifier.weight(1f)) {
                    if (value.isEmpty()) {
                        Text(
                            text = AuthCopy.PASSWORD_PLACEHOLDER,
                            style = MaterialTheme.typography.bodyMedium,
                            color = extended.mutedForeground,
                            maxLines = 1,
                        )
                    }
                    innerTextField()
                }
                Spacer(modifier = Modifier.width(BallastSpacing.sm))
                Icon(
                    imageVector = if (revealed) {
                        Icons.Outlined.VisibilityOff
                    } else {
                        Icons.Outlined.Visibility
                    },
                    contentDescription = if (revealed) {
                        AuthCopy.HIDE_PASSWORD
                    } else {
                        AuthCopy.SHOW_PASSWORD
                    },
                    modifier = Modifier
                        .size(20.dp)
                        .clickable(enabled = enabled) { revealed = !revealed },
                    tint = extended.mutedForeground,
                )
            }
        }

        if (errorMessage != null) {
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = scheme.error,
            )
        }
    }
}

/**
 * The destructive alert every auth form shows above its submit button.
 *
 * A title as well as the message because the message alone is often a bare
 * sentence about a password, and the user needs to know which action it refers
 * to — the web pairs "Sign in failed" with the same description for the same
 * reason.
 */
@Composable
fun AuthErrorAlert(
    title: String,
    message: String,
    modifier: Modifier = Modifier,
) {
    BallastAlert(
        title = title,
        modifier = modifier,
        description = message,
        variant = AlertVariant.DESTRUCTIVE,
        icon = Icons.Filled.ErrorOutline,
    )
}

/** A muted sentence with one inline action, as the web card footers have. */
@Composable
fun AuthFooterPrompt(
    prompt: String,
    actionText: String,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(BallastSpacing.xs),
    ) {
        Text(
            text = prompt,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
        BallastButton(
            text = actionText,
            onClick = onAction,
            variant = ButtonVariant.LINK,
            size = ButtonSize.SMALL,
        )
    }
}

/**
 * Personal or Business, as two selectable rows.
 *
 * The web carries this in a `?for=` query parameter set by the landing page, so
 * a visitor has already chosen before they reach the form. A phone has no
 * landing page in front of it, so the choice has to be part of signup: the
 * value ends up in Supabase user metadata under `workspace_type`, and it is
 * what decides whether the first workspace is created with invoices and a team
 * or with budgets and goals.
 *
 * Radio rows rather than a segmented control: each option needs its
 * one-line description, and the two descriptions are the actual decision.
 */
@Composable
fun EditionChoice(
    selected: WorkspaceType,
    onSelect: (WorkspaceType) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
    ) {
        Text(
            text = AuthCopy.EDITION_QUESTION,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        // Personal first: it is the shorter commitment and the more common
        // choice on a phone.
        listOf(WorkspaceType.PERSONAL, WorkspaceType.BUSINESS).forEach { type ->
            EditionRow(
                type = type,
                selected = type == selected,
                onSelect = { onSelect(type) },
                enabled = enabled,
            )
        }
    }
}

@Composable
private fun EditionRow(
    type: WorkspaceType,
    selected: Boolean,
    onSelect: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    Row(
        modifier = modifier
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = if (selected) scheme.primary else MaterialTheme.ballastColors.cardBorder,
                shape = FieldShape,
            )
            // `selectable` rather than `clickable`: it gives the row the radio
            // role, so a screen reader announces "selected" and the whole row
            // becomes the target rather than the 20dp button.
            .selectable(
                selected = selected,
                enabled = enabled,
                role = Role.RadioButton,
                onClick = onSelect,
            )
            .padding(BallastSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(BallastSpacing.md),
    ) {
        RadioButton(
            selected = selected,
            // Null: the row above already handles the click, and a second
            // target inside it would be announced twice.
            onClick = null,
            enabled = enabled,
            colors = RadioButtonDefaults.colors(
                selectedColor = scheme.primary,
                unselectedColor = scheme.outline,
            ),
        )
        Column(verticalArrangement = Arrangement.spacedBy(BallastSpacing.xxs)) {
            Text(
                text = AuthCopy.editionChoiceLabel(type),
                style = MaterialTheme.typography.titleSmall,
                color = scheme.onSurface,
            )
            Text(
                text = AuthCopy.editionChoiceDescription(type),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.ballastColors.mutedForeground,
            )
        }
    }
}

/** `h-9` on the web, matching `BallastTextField`. */
private val FieldMinHeight = 36.dp

private val FieldShape = RoundedCornerShape(BallastRadius.md)

/** Roughly 45 characters at 14sp — a form wider than this is hard to scan. */
private val FormMaxWidth = 420.dp

private const val DISABLED_ALPHA = 0.5f
