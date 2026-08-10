package com.ballastmoney.android.data.remote.mapper

import com.ballastmoney.android.core.model.BalancePoint
import com.ballastmoney.android.core.model.CashAccount
import com.ballastmoney.android.core.model.CashPosition
import com.ballastmoney.android.core.model.CashSource
import com.ballastmoney.android.core.model.Category
import com.ballastmoney.android.core.model.CategorySlice
import com.ballastmoney.android.core.model.ConnectedAccount
import com.ballastmoney.android.core.model.ConnectionStatus
import com.ballastmoney.android.core.model.DashboardSnapshot
import com.ballastmoney.android.core.model.Entitlements
import com.ballastmoney.android.core.model.ExclusionReason
import com.ballastmoney.android.core.model.ImportBatch
import com.ballastmoney.android.core.model.IntegrationConnection
import com.ballastmoney.android.core.model.IntegrationProvider
import com.ballastmoney.android.core.model.IntegrationsOverview
import com.ballastmoney.android.core.model.LockedReason
import com.ballastmoney.android.core.model.MonthlyPoint
import com.ballastmoney.android.core.model.OnboardingState
import com.ballastmoney.android.core.model.Permission
import com.ballastmoney.android.core.model.PlanId
import com.ballastmoney.android.core.model.Profile
import com.ballastmoney.android.core.model.ProviderCapability
import com.ballastmoney.android.core.model.ProviderCategory
import com.ballastmoney.android.core.model.SessionBootstrap
import com.ballastmoney.android.core.model.Transaction
import com.ballastmoney.android.core.model.TransactionAggregates
import com.ballastmoney.android.core.model.TransactionType
import com.ballastmoney.android.core.model.Workspace
import com.ballastmoney.android.core.model.WorkspaceRole
import com.ballastmoney.android.core.model.WorkspaceSummary
import com.ballastmoney.android.core.model.WorkspaceType
import com.ballastmoney.android.data.remote.dto.BootstrapDto
import com.ballastmoney.android.data.remote.dto.CashAccountDto
import com.ballastmoney.android.data.remote.dto.CashPositionDto
import com.ballastmoney.android.data.remote.dto.ConnectionDto
import com.ballastmoney.android.data.remote.dto.DashboardResponseDto
import com.ballastmoney.android.data.remote.dto.EntitlementsDto
import com.ballastmoney.android.data.remote.dto.ImportBatchDto
import com.ballastmoney.android.data.remote.dto.IntegrationAccountDto
import com.ballastmoney.android.data.remote.dto.IntegrationsResponseDto
import com.ballastmoney.android.data.remote.dto.ProfileDto
import com.ballastmoney.android.data.remote.dto.ProviderCardDto
import com.ballastmoney.android.data.remote.dto.TransactionDto
import com.ballastmoney.android.data.remote.dto.TransactionSummaryDto
import com.ballastmoney.android.data.remote.dto.TransactionsResponseDto
import com.ballastmoney.android.data.remote.dto.WorkspaceDto
import com.ballastmoney.android.data.remote.dto.WorkspaceSummaryDto
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.ZoneOffset

/**
 * Wire types to domain types.
 *
 * This file exists because the domain model in `core/model` was written before
 * the API did, and the two disagree in a dozen small ways: the bootstrap payload
 * nests permissions under `membership`, the dashboard sends a category *name*
 * where the transactions list sends an object, percentages arrive as fractions
 * and are stored as whole numbers. Every one of those differences is resolved
 * here, once, so that no ViewModel or screen has to know the wire exists.
 *
 * Where the API simply does not carry something the domain model has — the
 * Personal-edition dashboard blocks, unread notification counts — the mapper
 * fills in the empty value and says so. That is honest: those screens render
 * their empty state rather than inventing data, and the gap is visible here
 * instead of being hidden behind a fake.
 */

// --- Enum parsing ----------------------------------------------------------

/**
 * Enums are parsed leniently in one direction only.
 *
 * An unrecognised value from the server is a version skew, not a bug to crash
 * on: this app stays installed for months after it stops being the newest
 * build. So each parser has a documented fallback, and the fallback is always
 * the *least* privileged or least surprising reading.
 */
internal fun transactionTypeOf(raw: String?): TransactionType =
    when (raw?.uppercase()) {
        "INCOME" -> TransactionType.INCOME
        else -> TransactionType.EXPENSE
    }

internal fun workspaceTypeOf(raw: String?): WorkspaceType =
    when (raw?.uppercase()) {
        "PERSONAL" -> WorkspaceType.PERSONAL
        else -> WorkspaceType.BUSINESS
    }

/** Unknown roles fall to VIEWER — the role that can do least. */
internal fun workspaceRoleOf(raw: String?): WorkspaceRole =
    WorkspaceRole.entries.firstOrNull { it.name == raw?.uppercase() } ?: WorkspaceRole.VIEWER

/** Unknown plans fall to FREE, so a skewed client never unlocks a paid gate. */
internal fun planIdOf(raw: String?): PlanId =
    PlanId.entries.firstOrNull { it.name == raw?.uppercase() } ?: PlanId.FREE

/**
 * Permissions the server names but this build does not know are dropped.
 *
 * Dropping is the safe direction: an unknown permission cannot unlock a screen
 * that does not exist yet, whereas mapping it to something known could unlock
 * the wrong one.
 */
internal fun permissionsOf(raw: List<String>): Set<Permission> =
    raw.mapNotNullTo(mutableSetOf()) { wire ->
        Permission.entries.firstOrNull { it.name.lowercase() == wire }
    }

internal fun cashSourceOf(raw: String?): CashSource =
    if (raw == "bank") CashSource.BANK else CashSource.TRANSACTIONS

internal fun connectionStatusOf(raw: String?): ConnectionStatus =
    when (raw?.uppercase()) {
        "ERROR" -> ConnectionStatus.ERROR
        "EXPIRED" -> ConnectionStatus.EXPIRED
        else -> ConnectionStatus.CONNECTED
    }

internal fun providerCategoryOf(raw: String?): ProviderCategory =
    when (raw) {
        "accounting" -> ProviderCategory.ACCOUNTING
        "productivity" -> ProviderCategory.PRODUCTIVITY
        else -> ProviderCategory.BANKING
    }

internal fun capabilitiesOf(raw: List<String>): Set<ProviderCapability> =
    raw.mapNotNullTo(mutableSetOf()) { wire ->
        when (wire) {
            "transactions" -> ProviderCapability.TRANSACTIONS
            "invoices" -> ProviderCapability.INVOICES
            "email" -> ProviderCapability.EMAIL
            "notifications" -> ProviderCapability.NOTIFICATIONS
            "calendar" -> ProviderCapability.CALENDAR
            else -> null
        }
    }

/**
 * Why an account's balance is not in the headline figure.
 *
 * `counted` is the positive case and maps to null: there is no exclusion to
 * explain. The other three are the server's own enum.
 */
internal fun exclusionReasonOf(raw: String?): ExclusionReason? = when (raw) {
    "excluded" -> ExclusionReason.EXCLUDED
    "no-balance" -> ExclusionReason.NO_BALANCE
    "other-currency" -> ExclusionReason.OTHER_CURRENCY
    else -> null
}

// --- Session ---------------------------------------------------------------

/**
 * Splits the single `fullName` the API sends into the first/last pair the
 * domain model holds.
 *
 * The first whitespace-separated token is the first name and the remainder is
 * the last name, so "Ada Lovelace" and "Ada King de Lovelace" both keep their
 * initials — which is the only thing the split is used for. A single-word name
 * yields a first name and no last name, and a blank one yields neither, leaving
 * [Profile.displayName] to fall back to the email address.
 */
internal fun splitFullName(fullName: String?): Pair<String?, String?> {
    val trimmed = fullName?.trim().orEmpty()
    if (trimmed.isEmpty()) return null to null
    val parts = trimmed.split(Regex("\\s+"), limit = 2)
    return parts[0] to parts.getOrNull(1)
}

fun ProfileDto.toDomain(): Profile {
    val (first, last) = splitFullName(fullName)
    return Profile(
        id = id,
        email = email,
        firstName = first,
        lastName = last,
        avatarUrl = avatarUrl,
        isAdmin = isAdmin,
    )
}

fun WorkspaceSummaryDto.toDomain(): WorkspaceSummary =
    WorkspaceSummary(id = id, name = name, type = workspaceTypeOf(type))

/**
 * The domain [Workspace] carries the viewer's role, which the wire keeps on
 * `membership` instead, so the role is passed in rather than read from the
 * workspace object.
 */
fun WorkspaceDto.toDomain(role: WorkspaceRole, fallbackCurrency: String): Workspace =
    Workspace(
        id = id,
        name = name,
        type = workspaceTypeOf(type),
        currency = currency ?: fallbackCurrency,
        role = role,
    )

fun EntitlementsDto.toDomain(): Entitlements = Entitlements(
    planId = planIdOf(planId),
    isTrial = isTrial,
    trialEndsAt = trialEndsAt,
    limits = limits,
)

/**
 * The launch payload.
 *
 * Two domain fields have no wire counterpart and are filled in rather than
 * faked: `onboarding.hasBankConnection` and `hasTransactions` (the endpoint
 * sends only the single `onboardingComplete` boolean) and
 * `unreadNotifications`, which no mobile endpoint serves yet. The checklist card
 * therefore keys off `completed` alone, and the notification dot stays hidden.
 */
fun BootstrapDto.toDomain(): SessionBootstrap {
    val role = workspaceRoleOf(membership.role)
    val currency = workspace.currency ?: profile.currency ?: DEFAULT_CURRENCY
    return SessionBootstrap(
        profile = profile.toDomain(),
        workspaces = workspaces.map { it.toDomain() },
        currentWorkspace = workspace.toDomain(role, currency),
        permissions = permissionsOf(membership.permissions),
        entitlements = entitlements.toDomain(),
        onboarding = OnboardingState(completed = onboardingComplete),
    )
}

// --- Dashboard -------------------------------------------------------------

/**
 * Reads the savings rate as a whole percent whichever way the server meant it.
 *
 * `MOBILE_API.md` documents it as "a fraction between 0 and 1" and its example
 * is `0.369`; the server's own serializer comments call the same field "whole
 * percent of this month's income kept". Rather than pick a side and be wrong
 * half the time, a magnitude of at most 1 is read as a fraction and anything
 * larger as an already-whole percent. The single genuinely ambiguous input is
 * exactly 1.0, which is read as 100% because that is what the contract says.
 */
internal fun savingsRateToWholePercent(value: Double): Int {
    if (!value.isFinite()) return 0
    val percent = if (value >= -1.0 && value <= 1.0) value * 100 else value
    return Math.round(percent).toInt()
}

/** Percent changes arrive as numbers and may be fractional; the UI shows whole. */
internal fun percentToInt(value: Double?): Int? =
    value?.takeIf { it.isFinite() }?.let { Math.round(it).toInt() }

fun CashAccountDto.toDomain(fallbackCurrency: String): CashAccount = CashAccount(
    id = id,
    name = label ?: connectionLabel ?: "Account",
    // The dashboard's cash account carries no mask of its own — the label the
    // server derived already prefers it — so there is nothing to fill in here.
    mask = null,
    balance = balance,
    currency = currency ?: fallbackCurrency,
    includeInTotals = includeInTotals,
    exclusionReason = if (counted) null else exclusionReasonOf(reason),
)

fun CashPositionDto.toDomain(fallbackCurrency: String): CashPosition {
    val resolvedCurrency = currency ?: fallbackCurrency
    return CashPosition(
        total = total,
        source = cashSourceOf(source),
        accounts = accounts.map { it.toDomain(resolvedCurrency) },
        countedAccounts = countedAccounts,
        excludedAccounts = excludedAccounts,
        // The domain model wants the number of banks; the wire sends them grouped.
        banks = banks.size,
    )
}

fun TransactionSummaryDto.toDomain(): Transaction = Transaction(
    id = id,
    type = transactionTypeOf(type),
    amount = amount,
    description = description,
    date = date.atStartOfDay(ZoneOffset.UTC).toInstant(),
    // The dashboard sends the category name only, with no id. Leaving the id
    // null would make every row read as uncategorized, so the name is what
    // decides: a present name means categorized, and the id is unavailable
    // until the row is opened from the transactions list.
    categoryId = category?.let { SYNTHETIC_CATEGORY_ID },
    categoryName = category,
    categoryColor = categoryColor,
)

/**
 * Share of the total each slice represents.
 *
 * The endpoint sends amounts without shares, and the chart needs percentages,
 * so they are computed here over the slices actually returned — which is the
 * right denominator: the server already trimmed the list to the top categories,
 * and dividing by a workspace-wide total would make the visible slices sum to
 * less than 100% for no reason the user could see.
 */
internal fun sharesOf(amounts: List<BigDecimal>): List<Double> {
    val total = amounts.fold(BigDecimal.ZERO) { sum, amount -> sum.add(amount.abs()) }
    if (total.signum() == 0) return amounts.map { 0.0 }
    return amounts.map { amount ->
        amount.abs()
            .multiply(BigDecimal(100))
            .divide(total, SHARE_SCALE, RoundingMode.HALF_UP)
            .toDouble()
    }
}

fun DashboardResponseDto.toDomain(fallbackCurrency: String): DashboardSnapshot {
    val resolvedCurrency = currency ?: dashboard.cash.currency ?: fallbackCurrency
    val shares = sharesOf(dashboard.categoryBreakdown.map { it.amount })
    return DashboardSnapshot(
        currency = resolvedCurrency,
        transactionCount = dashboard.transactionCount,
        cash = dashboard.cash.toDomain(resolvedCurrency),
        monthIncome = dashboard.monthIncome,
        monthExpenses = dashboard.monthExpenses,
        monthNet = dashboard.monthNet,
        savingsRatePct = savingsRateToWholePercent(dashboard.savingsRate),
        incomeChangePct = percentToInt(dashboard.incomeChangePct),
        expensesChangePct = percentToInt(dashboard.expensesChangePct),
        monthly = dashboard.monthlySeries.map { point ->
            MonthlyPoint(
                label = point.month,
                income = point.income,
                expenses = point.expenses,
                net = point.net,
            )
        },
        balanceHistory = dashboard.balanceHistory.map { point ->
            BalancePoint(date = point.date, balance = point.balance)
        },
        spendingByCategory = dashboard.categoryBreakdown.mapIndexed { index, point ->
            CategorySlice(
                name = point.category ?: "Uncategorized",
                color = point.color ?: DEFAULT_CATEGORY_COLOR,
                amount = point.amount,
                sharePct = shares.getOrElse(index) { 0.0 },
            )
        },
        largestExpenses = dashboard.largestExpenses.map { it.toDomain() },
        recentTransactions = dashboard.recentTransactions.map { it.toDomain() },
        // Everything below here is absent from `GET /api/dashboard`. The
        // endpoint serves one payload for both editions and does not carry the
        // Personal blocks or the Business teasers, so those cards render their
        // own empty state rather than being handed invented figures.
    )
}

// --- Transactions ----------------------------------------------------------

fun TransactionDto.toDomain(): Transaction = Transaction(
    id = id,
    type = transactionTypeOf(type),
    amount = amount,
    description = description,
    // A calendar day at UTC midnight, kept as that exact instant so the row
    // shows the day the server meant regardless of where the phone is.
    date = date.atStartOfDay(ZoneOffset.UTC).toInstant(),
    categoryId = category?.id,
    categoryName = category?.name,
    categoryColor = category?.color,
    counterparty = counterparty,
    importBatchId = importBatchId,
)

/**
 * Totals over the whole filtered set, paired with the total row count.
 *
 * `totalCount` comes from the envelope rather than from `totals`, because the
 * server computes the two separately: the sums are a `groupBy`, the count is a
 * `count`, and both cover every match rather than the page.
 */
fun TransactionsResponseDto.toAggregates(): TransactionAggregates = TransactionAggregates(
    income = totals.income,
    expenses = totals.expenses,
    net = totals.net,
    totalCount = totalCount,
)

fun ImportBatchDto.toDomain(): ImportBatch = ImportBatch(
    id = id,
    fileName = fileName,
    createdAt = createdAt ?: Instant.EPOCH,
)

/**
 * The categories present in a page of transactions.
 *
 * There is no categories endpoint in the mobile contract, so the filter sheet's
 * list is assembled from the categories seen on transactions and accumulated in
 * Room. It is therefore complete for what the user has actually got rather than
 * for what the workspace defines — a category with no transactions yet will not
 * appear until one does. That is a real limitation and the alternative is a
 * endpoint that does not exist.
 */
fun TransactionsResponseDto.categoriesSeen(): List<Category> =
    transactions.mapNotNull { transaction ->
        transaction.category?.let { category ->
            Category(
                id = category.id,
                name = category.name,
                type = transactionTypeOf(transaction.type),
                color = category.color ?: DEFAULT_CATEGORY_COLOR,
            )
        }
    }.distinctBy { it.id }

// --- Integrations ----------------------------------------------------------

fun IntegrationAccountDto.toDomain(fallbackCurrency: String): ConnectedAccount =
    ConnectedAccount(
        id = id,
        name = name ?: label,
        mask = mask,
        balance = effectiveBalance,
        currency = currency ?: fallbackCurrency,
        includeInTotals = includeInTotals,
    )

fun ConnectionDto.toDomain(providerName: String, fallbackCurrency: String): IntegrationConnection =
    IntegrationConnection(
        id = id,
        providerId = provider,
        title = title ?: displayName ?: institutionName ?: providerName,
        status = connectionStatusOf(status),
        lastSyncAt = lastSyncAt,
        lastError = lastError,
        // A full timestamp on the wire, and only the day is needed to say
        // "expires in 12 days". Read at UTC so it matches what the server meant.
        consentExpiresAt = consentExpiresAt?.atOffset(ZoneOffset.UTC)?.toLocalDate(),
        rateLimitedUntil = rateLimitedUntil,
        accounts = accounts.map { it.toDomain(fallbackCurrency) },
    )

fun ProviderCardDto.toDomain(): IntegrationProvider = IntegrationProvider(
    id = id,
    displayName = name,
    category = providerCategoryOf(category),
    capabilities = capabilitiesOf(capabilities),
    // The wire sends `syncable`, not the interval; a syncable provider gets the
    // domain model's default cadence and a push-only one gets null, which is
    // what the "Sync now" button actually keys off.
    syncIntervalHours = if (syncable) DEFAULT_SYNC_INTERVAL_HOURS else null,
    multiInstance = multiInstance,
    configured = configured,
)

/**
 * The provider grid.
 *
 * `locked` becomes [LockedReason.UPGRADE_REQUIRED] rather than an error, which
 * is the whole point of the flag: the grid renders behind an upgrade prompt.
 * The connections are flattened out of the providers because the domain model
 * keeps them in one list, each already carrying its `providerId`.
 */
fun IntegrationsResponseDto.toDomain(fallbackCurrency: String): IntegrationsOverview {
    val resolvedCurrency = currency ?: fallbackCurrency
    return IntegrationsOverview(
        providers = providers.map { it.toDomain() },
        connections = providers.flatMap { provider ->
            provider.connections.map { it.toDomain(provider.name, resolvedCurrency) }
        },
        lockedReason = if (locked) LockedReason.UPGRADE_REQUIRED else null,
    )
}

/** Falls back only when neither the workspace nor the profile states one. */
internal const val DEFAULT_CURRENCY = "EUR"

/** The palette lives in the database; this is only for a missing colour. */
internal const val DEFAULT_CATEGORY_COLOR = "#6366f1"

/**
 * Stands in for a category id the dashboard payload does not carry, so that a
 * named category does not read as uncategorized. It is never sent back to the
 * server: the dashboard's rows are display-only, and editing one goes through
 * the transactions list, which has the real id.
 */
internal const val SYNTHETIC_CATEGORY_ID = "dashboard-category"

private const val DEFAULT_SYNC_INTERVAL_HOURS = 12
private const val SHARE_SCALE = 4
