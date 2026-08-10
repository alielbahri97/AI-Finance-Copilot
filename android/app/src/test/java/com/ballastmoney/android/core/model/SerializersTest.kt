package com.ballastmoney.android.core.model

import com.ballastmoney.android.data.remote.BallastJson
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.math.BigDecimal
import java.time.Instant

/**
 * The wire format contract. If the API and these tests disagree, one of the two
 * is wrong and the app is showing incorrect money either way.
 */
class SerializersTest {

    @Test
    @DisplayName("money decodes from a string with its scale intact")
    fun moneyKeepsScale() {
        val json = """
            {
              "id": "tx_1",
              "type": "EXPENSE",
              "amount": "1234.50",
              "description": "Monthly rent",
              "date": "2026-08-10T14:32:00Z"
            }
        """.trimIndent()

        val transaction = BallastJson.decodeFromString<Transaction>(json)

        assertEquals(BigDecimal("1234.50"), transaction.amount)
        assertEquals(2, transaction.amount.scale(), "trailing zero was dropped, so 1234.50 would render as 1234.5")
        assertEquals(Instant.parse("2026-08-10T14:32:00Z"), transaction.date)
    }

    @Test
    @DisplayName("large amounts survive, which a Double would not")
    fun largeAmountsAreExact() {
        val json = """{"id":"tx_2","type":"INCOME","amount":"98765432109876.99","description":"Sale","date":"2026-08-10T00:00:00Z"}"""
        val transaction = BallastJson.decodeFromString<Transaction>(json)

        assertEquals(BigDecimal("98765432109876.99"), transaction.amount)
        // The point of the exercise: this value is not representable as a Double.
        assertTrue(
            transaction.amount.toDouble().toBigDecimal() != transaction.amount,
            "the fixture no longer demonstrates the precision problem",
        )
    }

    @Test
    @DisplayName("money re-encodes as a plain string, never in scientific notation")
    fun moneyEncodesAsPlainString() {
        val transaction = Transaction(
            id = "tx_3",
            type = TransactionType.EXPENSE,
            amount = BigDecimal("0.00000001"),
            description = "Rounding probe",
            date = Instant.parse("2026-08-10T00:00:00Z"),
        )

        val encoded = BallastJson.encodeToString(transaction)

        assertTrue(encoded.contains("\"amount\":\"0.00000001\""), encoded)
        assertTrue(!encoded.contains("E-"), "scientific notation leaked into the payload: $encoded")
    }

    @Test
    @DisplayName("an offset timestamp is honoured rather than assumed to be local")
    fun offsetsAreHonoured() {
        val json = """{"id":"tx_4","type":"INCOME","amount":"10.00","description":"Interest","date":"2026-08-10T16:32:00+02:00"}"""
        val transaction = BallastJson.decodeFromString<Transaction>(json)

        assertEquals(Instant.parse("2026-08-10T14:32:00Z"), transaction.date)
    }

    @Test
    @DisplayName("a numeric amount degrades instead of crashing the screen")
    fun numericAmountsStillDecode() {
        val json = """{"id":"tx_5","type":"EXPENSE","amount":42.5,"description":"Fee","date":"2026-08-10T00:00:00Z"}"""
        val transaction = BallastJson.decodeFromString<Transaction>(json)

        assertEquals(BigDecimal("42.5"), transaction.amount)
    }

    @Test
    @DisplayName("unknown fields are ignored, so a server that adds one cannot break an installed app")
    fun unknownFieldsAreIgnored() {
        val json = """
            {"id":"tx_6","type":"EXPENSE","amount":"1.00","description":"Coffee",
             "date":"2026-08-10T00:00:00Z","somethingTheServerAddedLater":{"nested":true}}
        """.trimIndent()

        val transaction = BallastJson.decodeFromString<Transaction>(json)
        assertEquals("Coffee", transaction.description)
    }

    @Test
    @DisplayName("a query round-trips, which is what type-safe navigation relies on")
    fun queryRoundTrips() {
        val query = TransactionQuery(
            search = "colruyt",
            type = TransactionType.EXPENSE,
            categoryId = TransactionQuery.UNCATEGORIZED,
            from = java.time.LocalDate.of(2026, 1, 1),
            to = java.time.LocalDate.of(2026, 8, 10),
            minAmount = BigDecimal("10.00"),
            maxAmount = BigDecimal("500.00"),
            sort = TransactionSortKey.AMOUNT,
            direction = SortDirection.ASC,
        )

        val decoded = BallastJson.decodeFromString<TransactionQuery>(BallastJson.encodeToString(query))
        assertEquals(query, decoded)
    }
}
