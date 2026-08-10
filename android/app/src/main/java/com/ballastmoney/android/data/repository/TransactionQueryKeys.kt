package com.ballastmoney.android.data.repository

import com.ballastmoney.android.core.model.TransactionQuery

/**
 * Turns a workspace and a filter set into the `queryKey` that
 * `transaction_pages`, `transaction_remote_keys` and `transaction_aggregates`
 * are all partitioned by.
 *
 * Three properties matter, in this order:
 *
 *  1. **Equal queries must agree.** Two [TransactionQuery] values that compare
 *     equal have to produce the same key, or the same screen would fetch the
 *     same page twice and store it under two names.
 *  2. **Different queries must never collide.** A collision is worse than a
 *     miss: it splices one ordering into another and the list shows rows that
 *     do not match the filter. This is why `hashCode()` is not used — 32 bits
 *     over an unbounded key space is a birthday problem waiting for a large
 *     enough cache, and the failure is silent.
 *  3. **Stable across processes.** The key is written to disk, so it cannot
 *     depend on anything that changes between runs — identity hashes, enum
 *     ordinals, map iteration order or the default locale.
 *
 * ### The encoding
 *
 * Fields are emitted in a fixed order — so the result is order-independent in
 * the only sense that matters, that the *caller* cannot influence it — and each
 * value is length-prefixed: `name:<length>:<value>|`. The length prefix is what
 * makes the key injective. A search for `"a|b"` and a search for `"a"` with
 * some other field set to `"b"` produce different keys, where a plain delimited
 * join would let one field's content impersonate another's. A null field is
 * written `name:-|`, which no non-null value can produce.
 *
 * Amounts are keyed on their string form, so `10.0` and `10.00` key
 * differently. That matches [TransactionQuery]'s own equality, which is
 * [java.math.BigDecimal]-scale-sensitive too, and the cost of the mismatch is
 * one redundant fetch rather than a wrong result.
 *
 * The key is versioned. Changing the encoding changes [KEY_VERSION], which
 * orphans every existing row rather than reinterpreting it; the paging tables
 * are a rebuildable cache, so orphaned rows are refetched and eventually
 * dropped with the database.
 */
fun transactionQueryKey(workspaceId: String, query: TransactionQuery): String {
    val key = StringBuilder(KEY_VERSION).append('|')
    key.field("ws", workspaceId)
    // Trimmed here and trimmed again when the request is built, so that
    // " coffee " and "coffee" share one cache entry rather than two.
    key.field("q", query.search.trim())
    key.field("type", query.type?.name)
    key.field("cat", query.categoryId)
    key.field("batch", query.importBatchId)
    key.field("from", query.from?.toString())
    key.field("to", query.to?.toString())
    key.field("min", query.minAmount?.toPlainString())
    key.field("max", query.maxAmount?.toPlainString())
    key.field("sort", query.sort.name)
    key.field("dir", query.direction.name)
    // The effective size, not the requested one: two queries that differ only
    // in an out-of-range page size are served identically and must share a
    // cache entry, and `position` is computed from this number.
    key.field("size", allowedPageSize(query.pageSize).toString())
    return key.toString()
}

/**
 * The prefix shared by every query key belonging to one workspace.
 *
 * Used to throw away all of a workspace's cached orderings and totals after a
 * write, when which rows match which filter can no longer be trusted. It is a
 * safe prefix precisely because the workspace field is length-prefixed and comes
 * first: no other workspace's key can begin with this string, and no later field
 * can be mistaken for part of it.
 */
fun transactionQueryKeyPrefix(workspaceId: String): String {
    val key = StringBuilder(KEY_VERSION).append('|')
    key.field("ws", workspaceId)
    return key.toString()
}

/**
 * The page size the endpoint will actually honour.
 *
 * `size` is restricted to 25, 50 or 100 and anything else is a documented
 * `400`, so a request is clamped up to the next offered size — up rather than
 * down, because asking for 30 and being given 50 shows the user more of what
 * they asked for, where 25 would show less.
 */
fun allowedPageSize(requested: Int): Int {
    val offered = TransactionQuery.PAGE_SIZE_OPTIONS
    return offered.firstOrNull { requested <= it } ?: offered.last()
}

private fun StringBuilder.field(name: String, value: String?) {
    append(name).append(':')
    if (value == null) append('-') else append(value.length).append(':').append(value)
    append('|')
}

private const val KEY_VERSION = "v1"
