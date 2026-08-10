package com.ballastmoney.android.data.remote.dto

import com.ballastmoney.android.core.model.InstantSerializer
import com.ballastmoney.android.core.model.PlanLimits
import kotlinx.serialization.Serializable
import java.time.Instant

/**
 * Wire shapes for `GET /api/session/bootstrap`, `GET /api/profile` and
 * `GET /api/workspace`.
 *
 * These mirror the JSON exactly, including names the domain model spells
 * differently — `workspace` rather than `currentWorkspace`, `membership`
 * wrapping the permission array, `onboardingComplete` as a bare boolean. The
 * domain types in `core/model` were designed before this API existed and are
 * shaped for the screens; keeping the two apart means a wire change is a change
 * to one mapper rather than to every ViewModel.
 */

@Serializable
data class BootstrapDto(
    val profile: ProfileDto,
    val workspaces: List<WorkspaceSummaryDto> = emptyList(),
    val workspace: WorkspaceDto,
    val membership: MembershipDto,
    val entitlements: EntitlementsDto,
    val onboardingComplete: Boolean = false,
)

@Serializable
data class ProfileDto(
    val id: String,
    val email: String,
    /**
     * One field, not a first/last pair — the web app collects a single name.
     * The domain model splits it; see the mapper for how.
     */
    val fullName: String? = null,
    val avatarUrl: String? = null,
    val currency: String? = null,
    /** Uppercase enum: `GROQ`, `OPENAI` or `ANTHROPIC`. */
    val aiProvider: String? = null,
    val isAdmin: Boolean = false,
    @Serializable(with = InstantSerializer::class)
    val tourCompletedAt: Instant? = null,
    @Serializable(with = InstantSerializer::class)
    val celebrationSeenAt: Instant? = null,
)

@Serializable
data class WorkspaceSummaryDto(
    val id: String,
    val name: String,
    /** `BUSINESS` or `PERSONAL`. */
    val type: String,
    /** Lowercase `business` or `personal`, derived from [type] by the server. */
    val edition: String? = null,
    /** `OWNER`, `ADMIN`, `MEMBER` or `VIEWER`. */
    val role: String? = null,
)

@Serializable
data class WorkspaceDto(
    val id: String,
    val name: String,
    val type: String,
    /** Lowercase: `business` or `personal`. Distinct from [type]. */
    val edition: String? = null,
    val currency: String? = null,
    val aiCategorizationEnabled: Boolean = false,
    val autoDunningEnabled: Boolean = false,
)

@Serializable
data class MembershipDto(
    val role: String,
    val memberId: String? = null,
    /** Sorted by the server, so two responses compare directly. */
    val permissions: List<String> = emptyList(),
)

/**
 * `limits` deserializes straight into the domain [PlanLimits] because the
 * server's `PlanLimits` interface and that data class have the same sixteen
 * field names. `usage` is a counter map, not money.
 */
@Serializable
data class EntitlementsDto(
    val planId: String,
    val planName: String? = null,
    val edition: String? = null,
    val workspaceType: String? = null,
    val limits: PlanLimits = PlanLimits(),
    val usage: UsageCountersDto = UsageCountersDto(),
    val isTrial: Boolean = false,
    @Serializable(with = InstantSerializer::class)
    val trialEndsAt: Instant? = null,
    val subscriptionStatus: String? = null,
    val cancelAtPeriodEnd: Boolean = false,
    @Serializable(with = InstantSerializer::class)
    val currentPeriodEnd: Instant? = null,
    val hasStripeCustomer: Boolean = false,
    /** Calendar month the counters belong to, `YYYY-MM`. */
    val period: String? = null,
)

/** Quota counters. Plain numbers by contract — quotas are not amounts. */
@Serializable
data class UsageCountersDto(
    val aiMessages: Int = 0,
    val aiCategorizations: Int = 0,
    val csvImports: Int = 0,
    val invoiceExtractions: Int = 0,
    val exports: Int = 0,
)

/** `GET /api/profile`. */
@Serializable
data class ProfileResponseDto(
    val profile: ProfileDto,
    val edition: String? = null,
    val workspace: WorkspaceDto? = null,
    val locationHint: String? = null,
    val supportedCurrencies: List<String> = emptyList(),
)

/** `GET /api/workspace`. */
@Serializable
data class WorkspaceResponseDto(
    val workspace: WorkspaceDto,
    /**
     * Null — not empty — in the Personal edition, which has no team. The
     * distinction is load-bearing: null means "this workspace has no concept of
     * members", where `[]` would read as "the team is empty".
     */
    val members: List<WorkspaceMemberDto>? = null,
    val seats: SeatsDto? = null,
)

@Serializable
data class WorkspaceMemberDto(
    val id: String,
    val userId: String? = null,
    val role: String,
    val fullName: String? = null,
    val email: String? = null,
    val permissions: List<String> = emptyList(),
    val overrides: PermissionOverridesDto = PermissionOverridesDto(),
    @Serializable(with = InstantSerializer::class)
    val joinedAt: Instant? = null,
)

@Serializable
data class PermissionOverridesDto(
    val granted: List<String> = emptyList(),
    val revoked: List<String> = emptyList(),
)

@Serializable
data class SeatsDto(
    val used: Int = 0,
    /** Null means unlimited. */
    val limit: Int? = null,
    val planName: String? = null,
)
