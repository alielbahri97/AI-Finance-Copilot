package com.ballastmoney.android.data.remote.dto

import com.ballastmoney.android.core.model.BigDecimalSerializer
import com.ballastmoney.android.core.model.PlanLimits
import kotlinx.serialization.Serializable
import java.math.BigDecimal

/** Wire shape for `GET /api/billing/summary`. */
@Serializable
data class BillingSummaryDto(
    val entitlements: EntitlementsDto,
    /** `stripe`, `google_play`, `complimentary`, `trial` or `free`. */
    val planSource: String? = null,
    val plans: List<PlanDto> = emptyList(),
    val usage: UsageMetersDto = UsageMetersDto(),
    /** False when the server has no Stripe keys: say so rather than opening a checkout. */
    val billingConfigured: Boolean = false,
)

/**
 * Where the workspace's plan comes from.
 *
 * `GOOGLE_PLAY` is in the union so this client can switch on it from the first
 * release, but nothing returns it yet — there is no Play Billing integration in
 * the API. [UNKNOWN] absorbs a value a future server adds, so an unrecognised
 * source degrades to "we cannot manage this here" rather than to a crash.
 */
enum class PlanSource {
    STRIPE,
    GOOGLE_PLAY,
    COMPLIMENTARY,
    TRIAL,
    FREE,
    UNKNOWN,
    ;

    companion object {
        fun fromWire(raw: String?): PlanSource = when (raw) {
            "stripe" -> STRIPE
            "google_play" -> GOOGLE_PLAY
            "complimentary" -> COMPLIMENTARY
            "trial" -> TRIAL
            "free" -> FREE
            else -> UNKNOWN
        }
    }
}

/**
 * A plan in the price list.
 *
 * [monthlyPriceEur] is a plain number on purpose — a price list is not a
 * transaction amount and never enters money arithmetic — and the server also
 * sends the same figure as the money string [monthlyPrice] for clients that
 * would rather have one shape for every amount. Null in both means
 * contact-sales.
 */
@Serializable
data class PlanDto(
    val id: String,
    val edition: String? = null,
    val name: String = "",
    val description: String = "",
    val monthlyPriceEur: Double? = null,
    @Serializable(with = BigDecimalSerializer::class)
    val monthlyPrice: BigDecimal? = null,
    val limits: PlanLimits = PlanLimits(),
    val highlights: List<String> = emptyList(),
)

@Serializable
data class UsageMetersDto(
    val aiMessages: UsageMeterDto = UsageMeterDto(),
    val aiCategorizations: UsageMeterDto = UsageMeterDto(),
    val csvImports: UsageMeterDto = UsageMeterDto(),
    val invoiceExtractions: UsageMeterDto = UsageMeterDto(),
    val exports: UsageMeterDto = UsageMeterDto(),
)

/**
 * One quota meter.
 *
 * The two special limits are not interchangeable and the difference is visible
 * to the user:
 *
 *  - `limit == 0` means this edition does not have the feature at all. Hide the
 *    meter. Rendering "0 / 0" advertises something that cannot be bought here.
 *  - `limit == null` means unlimited. Show usage without a denominator.
 */
@Serializable
data class UsageMeterDto(
    val used: Int = 0,
    val limit: Int? = null,
) {
    /** True when this edition has no such feature, so the meter is hidden. */
    val absent: Boolean get() = limit == 0

    val unlimited: Boolean get() = limit == null

    /** Fraction consumed, or null when there is no denominator to divide by. */
    val fraction: Float?
        get() {
            val ceiling = limit ?: return null
            if (ceiling <= 0) return null
            return (used.toFloat() / ceiling.toFloat()).coerceIn(0f, 1f)
        }
}
