package com.ballastmoney.android.ui.bank

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ballastmoney.android.data.bank.BankInstitution
import com.ballastmoney.android.designsystem.component.AlertVariant
import com.ballastmoney.android.designsystem.component.BadgeVariant
import com.ballastmoney.android.designsystem.component.BallastAlert
import com.ballastmoney.android.designsystem.component.BallastAvatar
import com.ballastmoney.android.designsystem.component.BallastBadge
import com.ballastmoney.android.designsystem.component.BallastBottomSheet
import com.ballastmoney.android.designsystem.component.BallastButton
import com.ballastmoney.android.designsystem.component.BallastListRow
import com.ballastmoney.android.designsystem.component.BallastSearchField
import com.ballastmoney.android.designsystem.component.BallastSeparator
import com.ballastmoney.android.designsystem.component.ButtonSize
import com.ballastmoney.android.designsystem.component.ButtonVariant
import com.ballastmoney.android.designsystem.component.EmptyState
import com.ballastmoney.android.designsystem.component.ErrorState
import com.ballastmoney.android.designsystem.component.ListRowSkeleton
import com.ballastmoney.android.designsystem.theme.BallastSpacing
import com.ballastmoney.android.designsystem.theme.BallastTextStyles
import com.ballastmoney.android.designsystem.theme.BallastTheme
import com.ballastmoney.android.designsystem.theme.ballastColors

/**
 * Everything the picker can be asked to do, bundled so [BankPickerBody] stays
 * stateless and previewable.
 */
@Immutable
data class BankPickerActions(
    val onQueryChange: (String) -> Unit = {},
    val onChangeCountry: () -> Unit = {},
    val onCountrySelected: (String) -> Unit = {},
    val onCancelCountry: () -> Unit = {},
    val onInstitutionSelected: (BankInstitution) -> Unit = {},
    val onRetryLoad: () -> Unit = {},
    val onDismissStartError: () -> Unit = {},
)

/**
 * Pick a bank, then get sent to it.
 *
 * A sheet rather than a screen because navigation belongs to another agent's
 * package, and because this is a "pick one" flow, which is what
 * [BallastBottomSheet] exists for.
 *
 * [onTabOpened] fires once a browser has the consent page, so the host can start
 * expecting a resume. [onDismiss] is called immediately afterwards: leaving the
 * sheet open behind the browser means the user comes back to a bank list they
 * have finished with, on top of the card telling them what is happening.
 */
@Composable
fun BankPickerSheet(
    onDismiss: () -> Unit,
    onTabOpened: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: BankPickerViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val toolbarColor = MaterialTheme.colorScheme.surface.toArgb()

    LaunchedEffect(viewModel, toolbarColor, context) {
        viewModel.consentLaunches.collect { request ->
            val result = openBankConsent(
                context = context,
                url = request.url,
                toolbarColor = toolbarColor,
            )
            viewModel.onConsentTabResult(result)
            if (result !is ConsentTabResult.NoBrowser) {
                onTabOpened()
                onDismiss()
            }
        }
    }

    val actions = remember(viewModel) {
        BankPickerActions(
            onQueryChange = viewModel::onQueryChange,
            onChangeCountry = viewModel::onChangeCountry,
            onCountrySelected = viewModel::onCountrySelected,
            onCancelCountry = viewModel::onCancelCountry,
            onInstitutionSelected = viewModel::onInstitutionSelected,
            onRetryLoad = viewModel::retryLoad,
            onDismissStartError = viewModel::dismissStartError,
        )
    }

    BallastBottomSheet(
        onDismissRequest = onDismiss,
        title = when (state.step) {
            BankPickerStep.COUNTRY -> "Where do you bank?"
            BankPickerStep.INSTITUTION -> "Choose your bank"
        },
        description = when (state.step) {
            BankPickerStep.COUNTRY -> "Bank lists differ by country."
            BankPickerStep.INSTITUTION ->
                "You'll be sent to your bank to approve read-only access."
        },
        modifier = modifier,
    ) {
        BankPickerBody(state = state, actions = actions)
    }
}

/**
 * The sheet's contents without the sheet, because a modal sheet renders into its
 * own window and so never appears in a `@Preview`.
 */
@Composable
fun BankPickerBody(
    state: BankPickerUiState,
    actions: BankPickerActions,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.md),
    ) {
        BallastSearchField(
            value = state.query,
            onValueChange = actions.onQueryChange,
            placeholder = when (state.step) {
                BankPickerStep.COUNTRY -> "Search countries"
                BankPickerStep.INSTITUTION -> "Search ${state.countryName} banks"
            },
        )

        if (state.startError != null) {
            BallastAlert(
                title = "Couldn't open your bank",
                description = state.startError,
                variant = AlertVariant.WARNING,
                icon = Icons.Filled.Warning,
                action = {
                    BallastButton(
                        text = "Dismiss",
                        onClick = actions.onDismissStartError,
                        variant = ButtonVariant.OUTLINE,
                        size = ButtonSize.SMALL,
                    )
                },
            )
        }

        when (state.step) {
            BankPickerStep.COUNTRY -> CountryList(state = state, actions = actions)
            BankPickerStep.INSTITUTION -> InstitutionList(state = state, actions = actions)
        }
    }
}

@Composable
private fun CountryList(
    state: BankPickerUiState,
    actions: BankPickerActions,
    modifier: Modifier = Modifier,
) {
    val results = state.countryResults
    Column(modifier = modifier.fillMaxWidth()) {
        if (results.isEmpty()) {
            NoMatches(
                title = "No countries match",
                description = "Ballast connects banks across the EEA and the United " +
                    "Kingdom. Try the country's name or its two-letter code.",
            )
        } else {
            LazyColumn(modifier = Modifier.heightIn(max = ListMaxHeight)) {
                items(items = results, key = { it.code }) { country ->
                    BallastListRow(
                        title = country.name,
                        subtitle = country.code,
                        onClick = { actions.onCountrySelected(country.code) },
                        selected = country.code == state.country,
                    )
                    BallastSeparator()
                }
            }
        }
        Spacer(Modifier.height(BallastSpacing.sm))
        BallastButton(
            text = "Keep ${state.countryName}",
            onClick = actions.onCancelCountry,
            variant = ButtonVariant.GHOST,
            size = ButtonSize.SMALL,
        )
    }
}

@Composable
private fun InstitutionList(
    state: BankPickerUiState,
    actions: BankPickerActions,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BallastSpacing.sm),
    ) {
        CountryLine(
            countryName = state.countryName,
            onChangeCountry = actions.onChangeCountry,
        )

        when {
            state.loading -> ListRowSkeleton(rows = 6)

            state.loadError != null -> ErrorState(
                title = "Couldn't load banks",
                description = state.loadError,
                onRetry = if (state.loadErrorRetryable) actions.onRetryLoad else null,
            )

            state.showNoBanksInCountry -> EmptyState(
                icon = Icons.Outlined.AccountBalance,
                title = "No banks for ${state.countryName}",
                description = "Ballast has no bank list for this country yet. Pick " +
                    "another country, or import a statement instead.",
                primaryAction = {
                    BallastButton(
                        text = "Change country",
                        onClick = actions.onChangeCountry,
                        size = ButtonSize.SMALL,
                    )
                },
            )

            state.showNoMatches -> NoMatches(
                title = "No banks match",
                description = "Try part of the bank's name, or its BIC.",
            )

            else -> LazyColumn(modifier = Modifier.heightIn(max = ListMaxHeight)) {
                items(items = state.institutionResults, key = { it.id }) { institution ->
                    InstitutionRow(
                        institution = institution,
                        starting = state.startingInstitutionId == institution.id,
                        enabled = !state.starting,
                        onClick = { actions.onInstitutionSelected(institution) },
                    )
                    BallastSeparator()
                }
            }
        }
    }
}

@Composable
private fun InstitutionRow(
    institution: BankInstitution,
    starting: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val progress: (@Composable () -> Unit)? = if (starting) {
        { BallastBadge(text = "Opening…", variant = BadgeVariant.OUTLINE) }
    } else {
        null
    }
    BallastListRow(
        title = institution.name,
        modifier = modifier,
        subtitle = institution.bic,
        // Every row is dead while one is in flight, so a second bank cannot be
        // started against the first one's requisition.
        onClick = if (enabled) onClick else null,
        leading = {
            BallastAvatar(
                initials = institution.name,
                imageUrl = institution.logoUrl,
                size = AvatarSize,
            )
        },
        trailing = progress,
    )
}

@Composable
private fun CountryLine(
    countryName: String,
    onChangeCountry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = countryName,
            style = BallastTextStyles.micro,
            color = MaterialTheme.ballastColors.mutedForeground,
            modifier = Modifier.weight(1f),
        )
        BallastButton(
            text = "Change country",
            onClick = onChangeCountry,
            variant = ButtonVariant.LINK,
            size = ButtonSize.SMALL,
        )
    }
}

@Composable
private fun NoMatches(
    title: String,
    description: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth().padding(vertical = BallastSpacing.md)) {
        Text(text = title, style = BallastTextStyles.cardTitle)
        Spacer(Modifier.height(BallastSpacing.xxs))
        Text(
            text = description,
            style = BallastTextStyles.mutedBody,
            color = MaterialTheme.ballastColors.mutedForeground,
        )
    }
}

/**
 * Tall enough for six rows, short enough to leave the search box and the sheet's
 * own handle on screen. The list has to be bounded: it sits in a column rather
 * than a scrolling parent, and a Dutch bank list is over a hundred entries.
 */
private val ListMaxHeight = 360.dp

private val AvatarSize = 32.dp

// --- Previews --------------------------------------------------------------

private val PreviewInstitutions = listOf(
    BankInstitution(id = "ING_INGBNL2A", name = "ING", bic = "INGBNL2A"),
    BankInstitution(id = "ABNAMRO_ABNANL2A", name = "ABN AMRO", bic = "ABNANL2A"),
    BankInstitution(id = "RABOBANK_RABONL2U", name = "Rabobank", bic = "RABONL2U"),
    BankInstitution(id = "BUNQ_BUNQNL2A", name = "bunq", bic = "BUNQNL2A"),
    BankInstitution(id = "SANDBOXFINANCE_SFIN0000", name = "Sandbox Finance"),
)

@Composable
private fun PickerPreview(state: BankPickerUiState) {
    Surface(color = MaterialTheme.colorScheme.surface) {
        BankPickerBody(
            state = state,
            actions = BankPickerActions(),
            modifier = Modifier.padding(BallastSpacing.lg),
        )
    }
}

@Preview(name = "Bank picker light", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BankPickerLightPreview() {
    BallastTheme(darkTheme = false) {
        PickerPreview(
            BankPickerUiState(country = "NL", institutions = PreviewInstitutions),
        )
    }
}

@Preview(name = "Bank picker dark", showBackground = true, backgroundColor = 0xFF030507)
@Composable
private fun BankPickerDarkPreview() {
    BallastTheme(darkTheme = true) {
        PickerPreview(
            BankPickerUiState(country = "NL", institutions = PreviewInstitutions),
        )
    }
}

@Preview(name = "Bank picker starting", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BankPickerStartingPreview() {
    BallastTheme(darkTheme = false) {
        PickerPreview(
            BankPickerUiState(
                country = "NL",
                institutions = PreviewInstitutions,
                query = "in",
                startingInstitutionId = "ING_INGBNL2A",
            ),
        )
    }
}

@Preview(name = "Bank picker loading", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BankPickerLoadingPreview() {
    BallastTheme(darkTheme = false) {
        PickerPreview(BankPickerUiState(country = "GB", loading = true))
    }
}

@Preview(name = "Bank picker not configured", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BankPickerNotConfiguredPreview() {
    BallastTheme(darkTheme = false) {
        PickerPreview(
            BankPickerUiState(
                country = "NL",
                loadError = "Bank connections aren't set up on this Ballast server yet. " +
                    "Ask your administrator to configure them.",
                loadErrorRetryable = false,
            ),
        )
    }
}

@Preview(name = "Bank picker countries", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BankPickerCountriesPreview() {
    BallastTheme(darkTheme = false) {
        PickerPreview(
            BankPickerUiState(
                country = "NL",
                step = BankPickerStep.COUNTRY,
                institutions = PreviewInstitutions,
            ),
        )
    }
}

@Preview(name = "Bank picker no browser", showBackground = true, backgroundColor = 0xFFF8FAFD)
@Composable
private fun BankPickerNoBrowserPreview() {
    BallastTheme(darkTheme = false) {
        PickerPreview(
            BankPickerUiState(
                country = "NL",
                institutions = PreviewInstitutions,
                startError = "There's no browser on this device, so your bank's approval " +
                    "page can't be opened.",
            ),
        )
    }
}
