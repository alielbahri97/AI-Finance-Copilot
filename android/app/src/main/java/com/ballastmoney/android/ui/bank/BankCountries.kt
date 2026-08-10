package com.ballastmoney.android.ui.bank

import java.util.Locale

/** A country the bank picker can ask GoCardless for. */
data class BankCountry(
    /** Two-letter ISO 3166-1 code, which is what the endpoint takes. */
    val code: String,
    val name: String,
)

/** The provider ids this package knows how to connect. */
object BankProviders {
    const val GOCARDLESS = "gocardless"
}

/**
 * The countries GoCardless Bank Account Data covers: the EEA plus the United
 * Kingdom.
 *
 * Hard-coded rather than fetched, because there is no endpoint that lists them —
 * `/institutions` takes a country and cannot be asked which countries exist. The
 * list changes on the order of years, and the cost of it being one country stale
 * is that a user picks a neighbouring country and finds nothing, which the
 * picker's empty state already handles. The alternative, a free-text country
 * field, would send `400`s for every typo.
 */
object BankCountries {

    /**
     * Where the picker starts when the device gives no usable hint.
     *
     * The Netherlands, because that is where this product's workspaces, currency
     * default and every fixture in the codebase sit. It is a guess either way,
     * and one tap changes it.
     */
    const val FALLBACK_CODE: String = "NL"

    /** Alphabetical by name, which is the order the picker shows them in. */
    val all: List<BankCountry> = listOf(
        BankCountry("AT", "Austria"),
        BankCountry("BE", "Belgium"),
        BankCountry("BG", "Bulgaria"),
        BankCountry("HR", "Croatia"),
        BankCountry("CY", "Cyprus"),
        BankCountry("CZ", "Czechia"),
        BankCountry("DK", "Denmark"),
        BankCountry("EE", "Estonia"),
        BankCountry("FI", "Finland"),
        BankCountry("FR", "France"),
        BankCountry("DE", "Germany"),
        BankCountry("GR", "Greece"),
        BankCountry("HU", "Hungary"),
        BankCountry("IS", "Iceland"),
        BankCountry("IE", "Ireland"),
        BankCountry("IT", "Italy"),
        BankCountry("LV", "Latvia"),
        BankCountry("LI", "Liechtenstein"),
        BankCountry("LT", "Lithuania"),
        BankCountry("LU", "Luxembourg"),
        BankCountry("MT", "Malta"),
        BankCountry("NL", "Netherlands"),
        BankCountry("NO", "Norway"),
        BankCountry("PL", "Poland"),
        BankCountry("PT", "Portugal"),
        BankCountry("RO", "Romania"),
        BankCountry("SK", "Slovakia"),
        BankCountry("SI", "Slovenia"),
        BankCountry("ES", "Spain"),
        BankCountry("SE", "Sweden"),
        BankCountry("GB", "United Kingdom"),
    )

    /**
     * The country to open the picker on.
     *
     * The device's region is the best signal available without another API call:
     * `GET /api/profile` carries a `locationHint`, but there is no profile
     * repository in this build and adding one to read a default would be a
     * network round trip in front of a bank list. A region GoCardless does not
     * cover falls back rather than showing a country with no banks in it.
     */
    fun defaultCode(region: String = Locale.getDefault().country): String {
        val candidate = region.trim().uppercase()
        return if (all.any { it.code == candidate }) candidate else FALLBACK_CODE
    }

    /** The name to print, falling back to the code for anything unlisted. */
    fun nameFor(code: String): String {
        val candidate = code.trim().uppercase()
        return all.firstOrNull { it.code == candidate }?.name ?: candidate
    }

    /**
     * Countries matching a search box. The code is matched as well as the name so
     * that typing "NL" finds the Netherlands, which is what someone who knows
     * their country code will try first.
     */
    fun search(query: String): List<BankCountry> {
        val needle = query.trim()
        if (needle.isEmpty()) return all
        return all.filter { country ->
            country.name.contains(needle, ignoreCase = true) ||
                country.code.contains(needle, ignoreCase = true)
        }
    }
}
