package com.ballastmoney.android.core.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

/**
 * Money crosses the wire as a decimal string, never as a JSON number.
 *
 * A JSON number would be parsed into a Double somewhere along the way and
 * 0.1 + 0.2 would stop being 0.3. Decoding straight from the string into
 * [BigDecimal] keeps the scale the server sent, which for this app is always
 * two places (the Postgres columns are `Decimal(12,2)` and `Decimal(14,2)`).
 *
 * Decoding tolerates a bare JSON number too, because [Decoder.decodeString]
 * on a numeric literal returns its text. That is deliberate: it means a server
 * regression that starts emitting numbers degrades to a small precision risk
 * rather than a hard crash on every screen.
 */
object BigDecimalSerializer : KSerializer<BigDecimal> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("java.math.BigDecimal", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: BigDecimal) {
        encoder.encodeString(value.toPlainString())
    }

    override fun deserialize(decoder: Decoder): BigDecimal =
        BigDecimal(decoder.decodeString())
}

/**
 * Timestamps are ISO 8601 with an explicit offset, e.g. `2026-08-10T14:32:00Z`
 * or `2026-08-10T16:32:00+02:00`. Both parse; the offset is honoured and then
 * normalised to an instant, so the app never guesses a timezone.
 */
object InstantSerializer : KSerializer<Instant> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("java.time.Instant", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: Instant) {
        encoder.encodeString(DateTimeFormatter.ISO_INSTANT.format(value))
    }

    override fun deserialize(decoder: Decoder): Instant {
        val raw = decoder.decodeString()
        return runCatching { OffsetDateTime.parse(raw).toInstant() }
            .getOrElse { Instant.parse(raw) }
    }
}

/** Calendar dates with no time component, e.g. a `2026-08-10` filter bound. */
object LocalDateSerializer : KSerializer<LocalDate> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("java.time.LocalDate", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: LocalDate) {
        encoder.encodeString(value.toString())
    }

    override fun deserialize(decoder: Decoder): LocalDate =
        LocalDate.parse(decoder.decodeString())
}
