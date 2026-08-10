package com.ballastmoney.android.core.common

import java.math.BigDecimal
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale

/**
 * Currency and date formatting for one workspace.
 *
 * The web app picks a locale from the currency rather than from the user's
 * browser, so a EUR workspace reads as `1.234,56 €` and a GBP one as
 * `£1,234.56` regardless of who is looking. That is a deliberate product
 * decision — the numbers should look the way the business's accountant expects
 * — and it is reproduced here so the two clients agree.
 *
 * Instances are cheap but not free (a [NumberFormat] is built per instance), so
 * hold one per workspace rather than constructing one per row.
 */
class MoneyFormatter(
    private val currencyCode: String,
) {
    private val locale: Locale = localeForCurrency(currencyCode)

    private val currencyFormat: NumberFormat =
        NumberFormat.getCurrencyInstance(locale).apply {
            runCatching { currency = Currency.getInstance(currencyCode.uppercase()) }
            maximumFractionDigits = 2
            minimumFractionDigits = 2
        }

    private val compactFormat: NumberFormat =
        NumberFormat.getIntegerInstance(locale)

    private val dateFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("d MMM yyyy", locale)

    private val dateTimeFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("d MMM, HH:mm", locale)

    private val monthDayFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("d MMM", locale)

    /** `formatCurrency` on the web: two decimals, currency symbol, no sign games. */
    fun format(amount: BigDecimal): String = currencyFormat.format(amount)

    /**
     * Renders an amount with an explicit direction, mirroring `MoneyText`'s
     * `signed` prop. Note the Unicode minus sign (U+2212), not a hyphen — the
     * web app uses it because a hyphen at large type sizes reads as a dash and
     * sits at the wrong optical height.
     */
    fun formatSigned(amount: BigDecimal, direction: MoneyDirection): String {
        val magnitude = format(amount.abs())
        return when (direction) {
            MoneyDirection.INCOME -> "+$magnitude"
            MoneyDirection.EXPENSE -> "\u2212$magnitude"
            MoneyDirection.NONE -> format(amount)
        }
    }

    /**
     * Axis labels need to fit, so large values collapse to `1.2k` / `3.4M`.
     * Built by hand rather than with `NumberFormat.getCompactNumberInstance`,
     * which only exists from API 31 and this app supports API 26.
     */
    fun formatCompact(amount: BigDecimal): String {
        val abs = amount.abs()
        val sign = if (amount.signum() < 0) "\u2212" else ""
        return when {
            abs >= MILLION -> sign + trimZero(abs.divide(MILLION, 1, java.math.RoundingMode.HALF_UP)) + "M"
            abs >= THOUSAND -> sign + trimZero(abs.divide(THOUSAND, 1, java.math.RoundingMode.HALF_UP)) + "k"
            else -> sign + compactFormat.format(abs)
        }
    }

    fun formatDate(date: LocalDate): String = date.format(dateFormatter)

    fun formatDate(instant: Instant, zone: ZoneId = ZoneId.systemDefault()): String =
        dateFormatter.format(instant.atZone(zone))

    fun formatDateTime(instant: Instant, zone: ZoneId = ZoneId.systemDefault()): String =
        dateTimeFormatter.format(instant.atZone(zone))

    fun formatMonthDay(date: LocalDate): String = date.format(monthDayFormatter)

    private fun trimZero(value: BigDecimal): String {
        val text = value.toPlainString()
        return if (text.endsWith(".0")) text.dropLast(2) else text
    }

    companion object {
        private val THOUSAND = BigDecimal("1000")
        private val MILLION = BigDecimal("1000000")

        /**
         * `CURRENCY_LOCALES` from `src/lib/utils.ts`, with the same `en-US`
         * fallback for anything unlisted.
         */
        private val currencyLocales: Map<String, Locale> = mapOf(
            "USD" to Locale.forLanguageTag("en-US"),
            "EUR" to Locale.forLanguageTag("de-DE"),
            "GBP" to Locale.forLanguageTag("en-GB"),
            "AUD" to Locale.forLanguageTag("en-AU"),
            "CAD" to Locale.forLanguageTag("en-CA"),
            "CHF" to Locale.forLanguageTag("de-CH"),
            "JPY" to Locale.forLanguageTag("ja-JP"),
            "NZD" to Locale.forLanguageTag("en-NZ"),
        )

        fun localeForCurrency(currency: String?): Locale =
            currencyLocales[currency?.uppercase().orEmpty()] ?: Locale.forLanguageTag("en-US")
    }
}

/** Which way money moved, for sign and colour decisions. */
enum class MoneyDirection {
    INCOME,
    EXPENSE,
    NONE,
}
