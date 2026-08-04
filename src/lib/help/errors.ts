/**
 * Server-side misconfiguration (a missing API key, a retired model) reads as
 * an app fault to the person asking for help, so the chat tells them it is not
 * their doing and that an administrator has to act. Everything else is
 * presented as transient and worth retrying.
 */
const CONFIGURATION_SIGNALS = [
  /\bapi[ _]key\b/i,
  /\bmodel\b/i,
  /\bconfigur(?:ed|ation)\b/i,
  /\benvironment\b/i,
  // An env var name in the message (GROQ_API_KEY, GROQ_MODEL, ...) is only
  // ever addressed to whoever administers the deployment.
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/,
];

export function isConfigurationError(message: string): boolean {
  return CONFIGURATION_SIGNALS.some((signal) => signal.test(message));
}
