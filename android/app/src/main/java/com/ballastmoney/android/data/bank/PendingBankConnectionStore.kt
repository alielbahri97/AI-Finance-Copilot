package com.ballastmoney.android.data.bank

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Where the outstanding bank-connection reference lives between the Custom Tab
 * opening and `finalize` succeeding.
 *
 * An interface rather than a class so the resume-and-poll logic can be exercised
 * in a JVM unit test: the real implementation needs a `Context` to reach
 * DataStore, and a test that has to stand up Android to check "did we stop
 * nagging after the attempt expired" is testing the wrong thing.
 */
interface PendingBankConnectionStore {

    /** Emits null when nothing is outstanding, and again when one is cleared. */
    val pending: Flow<PendingBankConnection?>

    /** A one-shot read, for code that is about to act rather than to render. */
    suspend fun current(): PendingBankConnection?

    /**
     * Replaces whatever was there. There is deliberately no "add": one attempt
     * at a time is all the flow can be in, since the user is looking at one
     * browser tab.
     */
    suspend fun save(pending: PendingBankConnection)

    suspend fun clear()
}

/**
 * DataStore-backed, in the same preferences file the rest of the app's settings
 * use.
 *
 * ### Why plain storage rather than encrypted
 *
 * The reference is not a secret in the sense that matters. It is a
 * single-purpose, thirty-minute, server-side-scoped handle: `finalize` looks up
 * the pending row *and* re-checks that it belongs to the caller's user and
 * workspace, and answers `404` when it does not — the same answer as for a
 * reference that never existed. So a reference read off a compromised device
 * cannot be redeemed by anyone but its owner, who could simply connect the bank
 * again. Encrypting it would buy nothing and cost a keystore dependency in the
 * one place that has to survive process death reliably.
 *
 * ### Why the shared preferences file
 *
 * `CoreModule` provides exactly one `DataStore<Preferences>`, and DataStore is
 * explicit that two instances over one file corrupt each other. Adding a second
 * store would mean a second file; reusing this one with distinctly prefixed keys
 * means the pending record is written by the same serialised, atomic `edit` as
 * everything else.
 */
@Singleton
class DataStorePendingBankConnectionStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) : PendingBankConnectionStore {

    override val pending: Flow<PendingBankConnection?> =
        dataStore.data.map { preferences -> preferences.readPending() }

    override suspend fun current(): PendingBankConnection? =
        dataStore.data.first().readPending()

    override suspend fun save(pending: PendingBankConnection) {
        dataStore.edit { preferences ->
            preferences[Keys.REFERENCE] = pending.reference
            preferences[Keys.INSTITUTION_ID] = pending.institutionId
            preferences[Keys.INSTITUTION_NAME] = pending.institutionName
            preferences[Keys.EXPIRES_AT] = pending.expiresAt.toEpochMilli()
        }
    }

    override suspend fun clear() {
        dataStore.edit { preferences ->
            preferences.remove(Keys.REFERENCE)
            preferences.remove(Keys.INSTITUTION_ID)
            preferences.remove(Keys.INSTITUTION_NAME)
            preferences.remove(Keys.EXPIRES_AT)
        }
    }

    /**
     * A record is only a record if it has both a reference and an expiry.
     * Without the expiry there is no way to stop polling, so a half-written pair
     * is read as nothing rather than as an attempt that can never be abandoned.
     */
    private fun Preferences.readPending(): PendingBankConnection? {
        val reference = this[Keys.REFERENCE]?.takeIf { it.isNotBlank() } ?: return null
        val expiresAt = this[Keys.EXPIRES_AT] ?: return null
        return PendingBankConnection(
            reference = reference,
            institutionId = this[Keys.INSTITUTION_ID].orEmpty(),
            institutionName = this[Keys.INSTITUTION_NAME]?.takeIf { it.isNotBlank() }
                ?: UNNAMED_INSTITUTION,
            expiresAt = Instant.ofEpochMilli(expiresAt),
        )
    }

    private object Keys {
        val REFERENCE = stringPreferencesKey("pending_bank_reference")
        val INSTITUTION_ID = stringPreferencesKey("pending_bank_institution_id")
        val INSTITUTION_NAME = stringPreferencesKey("pending_bank_institution_name")
        val EXPIRES_AT = longPreferencesKey("pending_bank_expires_at_epoch_millis")
    }

    private companion object {
        /** Reads correctly in every sentence the flow puts a bank's name into. */
        const val UNNAMED_INSTITUTION = "your bank"
    }
}
