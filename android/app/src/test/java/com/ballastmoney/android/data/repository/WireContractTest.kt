package com.ballastmoney.android.data.repository

import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.data.remote.BallastApi
import com.ballastmoney.android.data.remote.mapper.toDomain
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.TimeZone

/**
 * The promises in `MOBILE_API.md` sections 2 and 3, asserted against real
 * responses rather than against the serializers in isolation.
 *
 * These are the failures that do not look like failures. A money value routed
 * through a `Double` still renders; it is just a cent out, once a month, on a
 * balance nobody can explain. A date-only value read through the device's
 * timezone still renders; it is just the wrong day for everyone west of
 * Greenwich. Both are cheap to prevent here and expensive to find in the wild,
 * which is why they are tested through the whole stack — engine, content
 * negotiation, DTO, mapper — instead of by calling the serializer directly.
 */
class WireContractTest {

    private val originalTimeZone: TimeZone = TimeZone.getDefault()

    /**
     * An absurd offset on purpose: UTC+14 is the furthest zone from UTC there
     * is, so a UTC-midnight timestamp read through the default zone lands on
     * the *next* day. If anything in the chain converts rather than reading the
     * day off the front of the string, these tests fail.
     */
    @BeforeEach
    fun useAnAwkwardDefaultTimeZone() {
        TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Kiritimati"))
    }

    @AfterEach
    fun restoreTimeZone() {
        TimeZone.setDefault(originalTimeZone)
    }

    @Test
    @DisplayName("money decoded from a string keeps its scale and never goes through a Double")
    fun moneyKeepsItsScale() = runTest {
        val api = BallastApi(testHttpClient(jsonEngine(transactionsBody)))

        val response = api.transactionsPage()
        val rent = response.transactions.first { it.id == "tx_rent" }

        assertEquals(BigDecimal("1234.50"), rent.amount)
        assertEquals(2, rent.amount.scale(), "the trailing zero was dropped, so 1234.50 renders as 1234.5")

        val huge = response.transactions.first { it.id == "tx_huge" }
        assertEquals(BigDecimal("98765432109876.99"), huge.amount)
        assertTrue(
            huge.amount.toDouble().toBigDecimal() != huge.amount,
            "the fixture stopped demonstrating the precision problem",
        )

        // Totals cover the whole filtered set and are money too, so they are
        // held to the same rule.
        assertEquals(BigDecimal("5310.55"), response.totals.expenses)
        assertEquals(2, response.totals.expenses.scale())
    }

    @Test
    @DisplayName("an absent amount is null, not 0.00")
    fun absentAmountsStayAbsent() = runTest {
        val api = BallastApi(testHttpClient(jsonEngine(integrationsBody)))

        val response = api.integrations(WORKSPACE_ID).getOrThrow()
        val accounts = response.providers.first().connections.first().accounts

        val funded = accounts.first { it.id == "acc_funded" }
        assertEquals(BigDecimal("1204.55"), funded.effectiveBalance)

        val pending = accounts.first { it.id == "acc_pending" }
        assertNull(
            pending.effectiveBalance,
            "a balance the bank has not reported yet became a figure the user would read as zero",
        )
        assertNull(pending.effectiveBalanceAt)

        // And the same distinction survives the mapper into the domain model,
        // which is what the accounts screen actually renders.
        val overview = response.toDomain(fallbackCurrency = "EUR")
        val mapped = overview.connections.first().accounts.first { it.id == "acc_pending" }
        assertNull(mapped.balance)
    }

    @Test
    @DisplayName("a UTC-midnight date reads as that calendar day whatever the device's timezone is")
    fun dateOnlyValuesIgnoreTheDeviceTimeZone() = runTest {
        assertEquals(
            "Pacific/Kiritimati",
            TimeZone.getDefault().id,
            "the awkward default timezone did not take, so this test proves nothing",
        )

        val api = BallastApi(testHttpClient(jsonEngine(transactionsBody)))
        val response = api.transactionsPage()
        val rent = response.transactions.first { it.id == "tx_rent" }

        assertEquals(LocalDate.of(2026, 8, 10), rent.date)
        // The domain model widens the day back to the instant the server meant,
        // which is UTC midnight and not the device's midnight.
        assertEquals(Instant.parse("2026-08-10T00:00:00Z"), rent.toDomain().date)
    }

    @Test
    @DisplayName("timestamps with milliseconds and an explicit Z parse as that instant")
    fun timestampsWithMillisecondsParse() = runTest {
        val api = BallastApi(testHttpClient(jsonEngine(transactionsBody)))
        val response = api.transactionsPage()

        val rent = response.transactions.first { it.id == "tx_rent" }
        assertEquals(Instant.parse("2026-08-09T18:22:41.123Z"), rent.createdAt)

        // A batch's timestamp is a real instant too, and the import list orders
        // on it, so a dropped millisecond field would reorder the sheet.
        assertEquals(
            Instant.parse("2026-01-05T10:00:00.000Z"),
            response.batches.first().createdAt,
        )
    }

    @Test
    @DisplayName("percentages and counts stay numbers, because they are not money")
    fun countsAndPercentagesAreNotMoney() = runTest {
        val api = BallastApi(testHttpClient(jsonEngine(dashboardBody)))

        val response = api.dashboard(WORKSPACE_ID).getOrThrow()

        assertEquals(BigDecimal("8420.00"), response.dashboard.monthIncome)
        // The elvis keeps the primitive overload in play; a null would fail the
        // comparison just as loudly as a wrong number.
        assertEquals(12.4, response.dashboard.incomeChangePct ?: 0.0)
        // Null rather than zero: there was no previous month to compare with,
        // which is a different statement from "no change".
        assertNull(response.dashboard.expensesChangePct)
        assertEquals(412, response.dashboard.transactionCount)
    }

    /**
     * The one call these tests make, spelled once.
     *
     * `getOrThrow` rather than an assertion on the `Result`: a transport failure
     * here means the fixture or the client setup is wrong, and the test is more
     * useful failing with that exception in it than with "expected success". What
     * a failure *maps to* is `ApiErrorMappingTest`'s subject, not this file's.
     */
    private suspend fun BallastApi.transactionsPage() =
        transactions(workspaceId = WORKSPACE_ID, query = TransactionQuery(), page = 1, pageSize = 25)
            .getOrThrow()

    private val transactionsBody = """
        {
          "transactions": [
            {
              "id": "tx_rent", "type": "EXPENSE", "amount": "1234.50", "currency": "EUR",
              "category": { "id": "cat_home", "name": "Rent", "color": "#5B8DEF" },
              "description": "Monthly rent", "counterparty": null,
              "date": "2026-08-10T00:00:00.000Z", "createdAt": "2026-08-09T18:22:41.123Z",
              "importBatchId": null
            },
            {
              "id": "tx_huge", "type": "INCOME", "amount": "98765432109876.99", "currency": "EUR",
              "description": "Sale of the company",
              "date": "2026-08-10T00:00:00.000Z", "createdAt": "2026-08-09T18:22:41.000Z"
            }
          ],
          "currency": "EUR",
          "page": 1, "pageSize": 25, "pageCount": 1, "totalCount": 2,
          "sort": "date", "dir": "desc",
          "totals": { "income": "8420.00", "expenses": "5310.55", "net": "3109.45" },
          "batches": [
            { "id": "b_jan", "fileName": "jan.csv", "createdAt": "2026-01-05T10:00:00.000Z", "transactionCount": 88 }
          ]
        }
    """.trimIndent()

    private val integrationsBody = """
        {
          "locked": false,
          "encryptionConfigured": true,
          "bankConnectionLimit": 1,
          "currency": "EUR",
          "providers": [
            {
              "id": "gocardless", "name": "GoCardless", "flow": "redirect", "configured": true,
              "connections": [
                {
                  "id": "conn_1", "provider": "gocardless", "status": "ACTIVE",
                  "institutionName": "ABN AMRO", "lastSyncAt": "2026-08-10T04:11:00.000Z",
                  "lastError": null,
                  "accounts": [
                    {
                      "id": "acc_funded", "name": "Payments", "mask": "1234", "currency": "EUR",
                      "balance": "1204.55", "balanceAt": "2026-08-10T04:11:00.000Z",
                      "includeInTotals": true
                    },
                    {
                      "id": "acc_pending", "name": "Savings", "mask": "9876", "currency": "EUR",
                      "balance": null, "balanceAt": null, "includeInTotals": true
                    }
                  ]
                }
              ]
            }
          ]
        }
    """.trimIndent()

    private val dashboardBody = """
        {
          "dashboard": {
            "monthIncome": "8420.00", "monthExpenses": "5310.55", "monthNet": "3109.45",
            "incomeChangePct": 12.4, "expensesChangePct": null,
            "totalBalance": "24180.10", "savingsRate": 0.369, "transactionCount": 412,
            "cash": {
              "source": "bank", "total": "24180.10", "currency": "EUR",
              "banks": [], "accounts": [], "countedAccounts": 3, "excludedAccounts": 1,
              "hasOtherCurrency": false, "asOf": "2026-08-10T04:11:00.000Z",
              "transactionBalance": "23110.00"
            },
            "monthlySeries": [ { "month": "Aug", "income": "8420.00", "expenses": "5310.55", "net": "3109.45" } ],
            "categoryBreakdown": [ { "category": "Groceries", "color": "#5B8DEF", "amount": "612.40" } ],
            "largestExpenses": [],
            "balanceHistory": [ { "date": "2026-08-01T00:00:00.000Z", "balance": "21000.00" } ],
            "recentTransactions": []
          },
          "currency": "EUR",
          "edition": "business",
          "sections": { "transactions": true, "invoices": true, "reports": false }
        }
    """.trimIndent()
}

private const val WORKSPACE_ID = "ws_9c1f"
