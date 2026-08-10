package com.ballastmoney.android.data.auth

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * The recovery link, taken apart.
 *
 * Worth testing on its own because the two Supabase flows put the credentials
 * in different halves of the URL — the implicit flow in the fragment, PKCE in
 * the query — and the fragment half is exactly what `android.net.Uri`'s query
 * accessors cannot see. Getting it wrong means a reset link that opens the app
 * and then says the link is invalid, which is indistinguishable from an expired
 * one and impossible for a user to work around.
 */
class AuthCallbackParserTest {

    @Test
    @DisplayName("the implicit flow's tokens are read out of the fragment")
    fun implicitFlow() {
        val link = AuthCallbackParser.parse(
            "ballast://auth/reset-password#access_token=header.payload.signature" +
                "&refresh_token=r-token&expires_in=3600&token_type=bearer&type=recovery",
        )

        requireNotNull(link)
        assertEquals("header.payload.signature", link.accessToken)
        assertEquals("r-token", link.refreshToken)
        assertEquals(3600L, link.expiresIn)
        assertEquals("bearer", link.tokenType)
        assertTrue(link.isRecovery)
        assertTrue(link.hasCredentials)
    }

    @Test
    @DisplayName("the PKCE flow's code is read out of the query")
    fun pkceFlow() {
        val link = AuthCallbackParser.parse(
            "ballast://auth/reset-password?code=abc-123&type=recovery",
        )

        requireNotNull(link)
        assertEquals("abc-123", link.code)
        assertNull(link.accessToken)
        assertTrue(link.isRecovery)
        assertTrue(link.hasCredentials)
    }

    @Test
    @DisplayName("the path alone marks a recovery link when Supabase omits the type")
    fun pathImpliesRecovery() {
        val link = AuthCallbackParser.parse("ballast://auth/reset-password?code=abc")

        requireNotNull(link)
        assertTrue(link.isRecovery)
    }

    @Test
    @DisplayName("a confirmation link is not a recovery link")
    fun confirmationIsNotRecovery() {
        val link = AuthCallbackParser.parse(
            "ballast://auth/confirmed#access_token=a&refresh_token=b&type=signup",
        )

        requireNotNull(link)
        assertFalse(link.isRecovery)
        assertTrue(link.hasCredentials)
    }

    @Test
    @DisplayName("an expired link carries its reason and no credentials")
    fun expiredLink() {
        val link = AuthCallbackParser.parse(
            "ballast://auth/reset-password#error=access_denied&error_code=otp_expired" +
                "&error_description=Email+link+is+invalid+or+has+expired",
        )

        requireNotNull(link)
        assertEquals("Email link is invalid or has expired", link.errorDescription)
        assertFalse(link.hasCredentials)
    }

    @Test
    @DisplayName("half a session is not a session")
    fun accessTokenWithoutRefreshTokenIsUnusable() {
        val link = AuthCallbackParser.parse("ballast://auth/reset-password#access_token=a")

        requireNotNull(link)
        assertFalse(link.hasCredentials)
    }

    @Test
    @DisplayName("anything that is not a Ballast auth callback is ignored")
    fun foreignUrisAreIgnored() {
        assertNull(AuthCallbackParser.parse(null))
        assertNull(AuthCallbackParser.parse("https://app.ballastmoney.com/reset-password"))
        assertNull(AuthCallbackParser.parse("ballast://transactions"))
    }
}
