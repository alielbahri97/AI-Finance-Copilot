package com.ballastmoney.android.data.repository

import androidx.paging.ExperimentalPagingApi
import androidx.paging.LoadType
import androidx.paging.PagingConfig
import androidx.paging.PagingState
import androidx.paging.RemoteMediator
import com.ballastmoney.android.core.model.TransactionQuery
import com.ballastmoney.android.data.local.TransactionEntity
import com.ballastmoney.android.data.local.TransactionRemoteKeyEntity
import com.ballastmoney.android.data.remote.ApiRoutes
import com.ballastmoney.android.data.remote.BallastApi
import com.ballastmoney.android.data.remote.BallastApiError
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * The paging plumbing, against a server that behaves like the real one.
 *
 * The fixture is a three-page set of sixty rows at the contract's default page
 * size, served by a handler that **clamps** the way the endpoint does: ask for
 * page 40 and you get page 3, with `page: 3` in the body. That single behaviour
 * is the reason this file exists. A mediator that trusted the page it asked for
 * would append the last page to itself on every scroll, forever, and the only
 * symptom would be a list that grows duplicates and a phone that gets warm.
 */
@OptIn(ExperimentalPagingApi::class)
class TransactionsRemoteMediatorTest {

    private val workspaceId = "ws_9c1f"
    private val query = TransactionQuery(pageSize = PAGE_SIZE)
    private val queryKey = transactionQueryKey(workspaceId, query)

    private val transactionDao = FakeTransactionDao()
    private val categoryDao = FakeCategoryDao()
    private val importBatchDao = FakeImportBatchDao()
    private val runner = FakeTransactionRunner()

    private val requestedPages = mutableListOf<Int>()

    /** Swapped by the test that checks a refresh replaces a stale ordering. */
    private var responder: (Int) -> String = { page -> pageBody(page.coerceIn(1, PAGE_COUNT)) }

    private val serverEngine = MockEngine { request ->
        val page = request.url.parameters[ApiRoutes.Params.PAGE]?.toIntOrNull() ?: 1
        requestedPages += page
        respond(
            content = responder(page),
            status = HttpStatusCode.OK,
            headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
        )
    }

    @Test
    @DisplayName("a first refresh stores the page in the order the server sent it")
    fun refreshStoresTheFirstPageInOrder() = runTest {
        val result = mediator().load(LoadType.REFRESH, emptyPagingState())

        assertEquals(false, endOfPaginationOf(result))
        assertEquals(listOf(1), requestedPages, "a refresh must start at page 1")

        assertEquals(idsFor(0 until PAGE_SIZE), transactionDao.orderedIds(queryKey))
        assertEquals(
            (0 until PAGE_SIZE).toList(),
            transactionDao.positionsFor(queryKey).map { it.position },
            "positions are what let the client replay the server's ordering",
        )

        val key = transactionDao.remoteKey(queryKey)
        assertEquals(PAGE_SIZE, key?.nextOffset ?: -1)
        assertEquals(false, key?.endOfPaginationReached ?: true)

        // Everything the payload carries beyond the rows lands in the same pass.
        val aggregates = transactionDao.observeAggregates(queryKey).first()
        assertEquals(TOTAL_COUNT, aggregates?.totalCount ?: -1)
        assertEquals(25_000L, aggregates?.expensesMinor ?: -1L)
        assertEquals(1, categoryDao.stored.size, "the categories seen on the page were not accumulated")
        assertEquals(1, importBatchDao.stored.size, "batches ignore the filter and are stored on every load")
        assertEquals(1, runner.commits, "the page was not written in a single transaction")
    }

    @Test
    @DisplayName("an append continues from the stored offset and does not repeat a row")
    fun appendContinues() = runTest {
        val mediator = mediator()
        mediator.load(LoadType.REFRESH, emptyPagingState())

        val result = mediator.load(LoadType.APPEND, emptyPagingState())

        assertEquals(false, endOfPaginationOf(result))
        assertEquals(listOf(1, 2), requestedPages)

        val ordered = transactionDao.orderedIds(queryKey)
        assertEquals(idsFor(0 until 2 * PAGE_SIZE), ordered)
        assertEquals(ordered.size, ordered.toSet().size, "paging stored the same transaction twice")
        assertEquals(2 * PAGE_SIZE, transactionDao.remoteKey(queryKey)?.nextOffset ?: -1)
    }

    @Test
    @DisplayName("the last page ends pagination, and a further append makes no request")
    fun lastPageEndsPagination() = runTest {
        val mediator = mediator()
        mediator.load(LoadType.REFRESH, emptyPagingState())
        mediator.load(LoadType.APPEND, emptyPagingState())

        val result = mediator.load(LoadType.APPEND, emptyPagingState())

        assertEquals(true, endOfPaginationOf(result))
        assertEquals(listOf(1, 2, 3), requestedPages)
        assertEquals(TOTAL_COUNT, transactionDao.orderedIds(queryKey).size)

        // Once the end is recorded, Paging can still ask; the mediator must
        // answer from the stored key rather than spending a request to be told
        // the same thing.
        val afterTheEnd = mediator.load(LoadType.APPEND, emptyPagingState())
        assertEquals(true, endOfPaginationOf(afterTheEnd))
        assertEquals(listOf(1, 2, 3), requestedPages)
    }

    @Test
    @DisplayName("a clamped page ends pagination instead of paging the tail forever")
    fun clampedPageEndsPagination() = runTest {
        // As if the user had scrolled a much longer list before a filter shrank
        // it: the stored offset now points past the end of the result set.
        transactionDao.upsertRemoteKey(
            TransactionRemoteKeyEntity(
                queryKey = queryKey,
                nextOffset = 39 * PAGE_SIZE,
                endOfPaginationReached = false,
                lastRefreshEpochMillis = 0L,
            ),
        )

        val result = mediator().load(LoadType.APPEND, emptyPagingState())

        assertEquals(listOf(40), requestedPages, "the offset should have asked for page 40")
        assertEquals(
            true,
            endOfPaginationOf(result),
            "the server answered with page 3; treating that as a normal page loops forever",
        )

        // Nothing is filed. The rows in a clamped answer belong at positions
        // 50..59, which is not where the request was reaching for, and writing
        // them at either offset is wrong: at 975 they leave a nine-hundred-row
        // hole in the ordering, and at 50 they overwrite positions that a
        // sequential append already owns. Discarding them costs one wasted
        // response and keeps the cached ordering contiguous.
        assertTrue(
            transactionDao.orderedIds(queryKey).isEmpty(),
            "a clamped page was filed into the ordering, which puts rows in the wrong place",
        )
        assertEquals(
            39 * PAGE_SIZE,
            transactionDao.remoteKey(queryKey)?.nextOffset ?: -1,
            "the offset moved on an answer that carried nothing new",
        )
        assertEquals(true, transactionDao.remoteKey(queryKey)?.endOfPaginationReached ?: false)

        // The totals and the batch list are not per-page, so they are worth
        // keeping even from an answer whose rows are not.
        assertEquals(TOTAL_COUNT, transactionDao.observeAggregates(queryKey).first()?.totalCount ?: -1)
    }

    @Test
    @DisplayName("a refresh replaces the previous ordering rather than splicing into it")
    fun refreshReplacesTheOrdering() = runTest {
        val mediator = mediator()
        mediator.load(LoadType.REFRESH, emptyPagingState())
        mediator.load(LoadType.APPEND, emptyPagingState())
        assertEquals(2 * PAGE_SIZE, transactionDao.orderedIds(queryKey).size)

        // The same query, sorted differently by the server between the two
        // calls — a row added elsewhere is enough to cause this.
        responder = { page -> pageBody(page.coerceIn(1, PAGE_COUNT), reversed = true) }
        mediator.load(LoadType.REFRESH, emptyPagingState())

        assertEquals(
            idsFor((0 until PAGE_SIZE).reversed()),
            transactionDao.orderedIds(queryKey),
            "the old ordering survived the refresh, so the list would show two orderings at once",
        )
        assertEquals(PAGE_SIZE, transactionDao.remoteKey(queryKey)?.nextOffset ?: -1)
    }

    @Test
    @DisplayName("a prepend is always the end: offset paging has nothing above page 1")
    fun prependIsAlwaysTheEnd() = runTest {
        val result = mediator().load(LoadType.PREPEND, emptyPagingState())

        assertEquals(true, endOfPaginationOf(result))
        assertTrue(requestedPages.isEmpty(), "a prepend spent a request on a page that cannot exist")
    }

    @Test
    @DisplayName("a refused request surfaces as the typed error, not as a raw HTTP exception")
    fun failuresKeepTheirType() = runTest {
        val engine = jsonEngine(
            """{"error":"You cannot view transactions.","code":"FORBIDDEN","permission":"view_transactions"}""",
            HttpStatusCode.Forbidden,
        )

        val result = mediator(engine).load(LoadType.REFRESH, emptyPagingState())

        assertTrue(result is RemoteMediator.MediatorResult.Error, "expected an Error, got $result")
        val error = result as RemoteMediator.MediatorResult.Error
        assertFailureIs<BallastApiError.Forbidden>(error.throwable)
        assertEquals(0, runner.commits, "a failed load wrote to the database anyway")
    }

    private fun mediator(engine: MockEngine = serverEngine) = TransactionsRemoteMediator(
        workspaceId = workspaceId,
        query = query,
        pageSize = PAGE_SIZE,
        api = BallastApi(testHttpClient(engine)),
        transactionDao = transactionDao,
        categoryDao = categoryDao,
        importBatchDao = importBatchDao,
        runner = runner,
        nowEpochMillis = { FIXED_NOW },
    )

    private fun endOfPaginationOf(result: RemoteMediator.MediatorResult): Boolean {
        assertTrue(result is RemoteMediator.MediatorResult.Success, "expected Success, got $result")
        return (result as RemoteMediator.MediatorResult.Success).endOfPaginationReached
    }

    private fun emptyPagingState(): PagingState<Int, TransactionEntity> = PagingState(
        pages = emptyList(),
        anchorPosition = null,
        config = PagingConfig(pageSize = PAGE_SIZE),
        leadingPlaceholderCount = 0,
    )

    private fun idsFor(indices: Iterable<Int>): List<String> = indices.map { "tx_$it" }

    /**
     * One page of the fixture. Rows are numbered globally, so a duplicate or a
     * gap in the stored ordering is visible as a wrong id rather than as a
     * count that happens to match.
     */
    private fun pageBody(page: Int, reversed: Boolean = false): String {
        val firstIndex = (page - 1) * PAGE_SIZE
        val size = (TOTAL_COUNT - firstIndex).coerceIn(0, PAGE_SIZE)
        val indices = (firstIndex until firstIndex + size).let { range ->
            if (reversed) range.reversed().toList() else range.toList()
        }
        val rows = indices.joinToString(",") { index ->
            """
            {"id":"tx_$index","type":"EXPENSE","amount":"10.00","currency":"EUR",
             "category":{"id":"cat_groceries","name":"Groceries","color":"#5B8DEF"},
             "description":"Row $index","counterparty":null,
             "date":"2026-08-09T00:00:00.000Z","createdAt":"2026-08-09T18:22:41.000Z",
             "importBatchId":"b_jan"}
            """.trimIndent()
        }
        return """
            {"transactions":[$rows],"currency":"EUR",
             "page":$page,"pageSize":$PAGE_SIZE,"pageCount":$PAGE_COUNT,"totalCount":$TOTAL_COUNT,
             "sort":"date","dir":"desc",
             "totals":{"income":"0.00","expenses":"250.00","net":"-250.00"},
             "batches":[{"id":"b_jan","fileName":"jan.csv","createdAt":"2026-01-05T10:00:00.000Z","transactionCount":88}]}
        """.trimIndent()
    }
}

private const val PAGE_SIZE = 25
private const val PAGE_COUNT = 3
private const val TOTAL_COUNT = 60
private const val FIXED_NOW = 1_760_000_000_000L
