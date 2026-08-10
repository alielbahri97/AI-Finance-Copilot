package com.ballastmoney.android.data.remote

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.LocalDate

/**
 * Reads a calendar day out of a full timestamp.
 *
 * `MOBILE_API.md` section 3 is explicit about this: a value that means a day
 * rather than an instant — a transaction's date, an invoice's due date — is
 * stored at UTC midnight and sent as a complete timestamp,
 * `2026-08-10T00:00:00.000Z`. The documented way to read it is to **take the
 * first ten characters**, and that is what this does.
 *
 * Converting through a timezone would be the bug this exists to prevent: a
 * device in Los Angeles turning UTC midnight into the previous day would show
 * every transaction dated one day early.
 *
 * Encoding widens back to UTC midnight so a round trip is lossless.
 */
object WireDaySerializer : KSerializer<LocalDate> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("com.ballastmoney.wire.Day", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: LocalDate) {
        encoder.encodeString("${value}T00:00:00.000Z")
    }

    override fun deserialize(decoder: Decoder): LocalDate {
        val raw = decoder.decodeString()
        // Tolerates a bare `YYYY-MM-DD` as well, which is what the query
        // parameters use, so one serializer covers both directions.
        return LocalDate.parse(raw.take(DAY_LENGTH))
    }

    private const val DAY_LENGTH = 10
}

/**
 * Formats a [LocalDate] as a `from`/`to` query parameter.
 *
 * Plain `YYYY-MM-DD`, per section 3: the server reads `from` as that day's UTC
 * start and `to` as its UTC end, so a range is inclusive at both ends. Sending
 * a full timestamp here would not be understood.
 */
internal fun LocalDate.toDayParam(): String = toString()
