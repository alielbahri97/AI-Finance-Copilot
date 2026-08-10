package com.ballastmoney.android.core.common

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.math.BigDecimal
import java.time.LocalDate

class MoneyFormatterTest {

    @Test
    @DisplayName("the currency picks the locale, not the device")
    fun currencyDrivesLocale() {
        // Asserted on content rather than on an exact string: the grouping and
        // decimal characters, and the symbol's side, come from the JDK's CLDR
        // data and change between JDK versions. What must not change is that a
        // euro workspace formats the German way and a sterling one the British
        // way, whatever locale the phone is set to.
        val euros = MoneyFormatter("EUR").format(BigDecimal("1234.56"))
        assertTrue(euros.contains("1.234,56"), "EUR should group with dots and a decimal comma: $euros")
        assertTrue(euros.contains("€"), "missing the euro sign: $euros")

        val pounds = MoneyFormatter("GBP").format(BigDecimal("1234.56"))
        assertTrue(pounds.contains("1,234.56"), "GBP should group with commas: $pounds")
        assertTrue(pounds.startsWith("£"), "GBP puts the symbol first: $pounds")
    }

    @Test
    @DisplayName("an unlisted currency falls back to US formatting rather than failing")
    fun unknownCurrencyFallsBack() {
        val formatted = MoneyFormatter("SEK").format(BigDecimal("99.90"))
        assertTrue(formatted.contains("99.90"), formatted)
    }

    @Test
    @DisplayName("two decimals always, so a column of amounts lines up")
    fun alwaysTwoDecimals() {
        val formatter = MoneyFormatter("USD")
        assertEquals("$1,000.00", formatter.format(BigDecimal("1000")))
        assertEquals("$0.50", formatter.format(BigDecimal("0.5")))
    }

    @Test
    @DisplayName("signed amounts use a real minus sign, not a hyphen")
    fun signedUsesUnicodeMinus() {
        val formatter = MoneyFormatter("USD")
        val expense = formatter.formatSigned(BigDecimal("42.00"), MoneyDirection.EXPENSE)
        assertTrue(expense.startsWith("\u2212"), "expected U+2212: $expense")
        assertTrue(!expense.contains('-'), "a hyphen leaked in: $expense")

        assertEquals("+$42.00", formatter.formatSigned(BigDecimal("42.00"), MoneyDirection.INCOME))
        assertEquals("$42.00", formatter.formatSigned(BigDecimal("42.00"), MoneyDirection.NONE))
    }

    @Test
    @DisplayName("an expense stays an expense even if the amount arrives negative")
    fun signedIgnoresIncomingSign() {
        val formatter = MoneyFormatter("USD")
        assertEquals(
            formatter.formatSigned(BigDecimal("42.00"), MoneyDirection.EXPENSE),
            formatter.formatSigned(BigDecimal("-42.00"), MoneyDirection.EXPENSE),
        )
    }

    @Test
    @DisplayName("compact amounts fit an axis label")
    fun compactFormatting() {
        val formatter = MoneyFormatter("USD")
        assertEquals("999", formatter.formatCompact(BigDecimal("999")))
        assertEquals("1k", formatter.formatCompact(BigDecimal("1000")))
        assertEquals("1.2k", formatter.formatCompact(BigDecimal("1234")))
        assertEquals("12.3k", formatter.formatCompact(BigDecimal("12345")))
        assertEquals("1.2M", formatter.formatCompact(BigDecimal("1234567")))
        assertEquals("\u22122.5k", formatter.formatCompact(BigDecimal("-2500")))
    }

    @Test
    @DisplayName("dates read as a person would write them")
    fun dateFormatting() {
        val formatter = MoneyFormatter("GBP")
        assertEquals("10 Aug 2026", formatter.formatDate(LocalDate.of(2026, 8, 10)))
        assertEquals("10 Aug", formatter.formatMonthDay(LocalDate.of(2026, 8, 10)))
    }
}
