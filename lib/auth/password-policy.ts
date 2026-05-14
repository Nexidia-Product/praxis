/**
 * Password policy — shared validation used by every flow that sets a
 * password (signup-via-invite, admin-issued reset, user-driven forgot-
 * password). Centralized here so the rules stay consistent and any
 * future tightening only edits one file.
 *
 * Policy (AUTH-10):
 *
 *   - Minimum length: 12 characters. The previous 8-char minimum is
 *     widely considered too weak for any account that grants admin or
 *     project-lead access.
 *   - Must contain at least 3 of these 4 character classes: lowercase
 *     letter, uppercase letter, digit, special character. This is the
 *     NIST SP 800-63B "memorized secret" guidance loosened by one
 *     class to keep the rule tractable for users without a manager.
 *   - Whitespace at start or end is rejected because it's almost
 *     always an unintentional copy/paste artifact.
 *
 * What we deliberately DO NOT do:
 *
 *   - No "must contain a number" forced rules. NIST SP 800-63B
 *     recommends against composition rules that mandate every class.
 *     The 3-of-4 approach gives flexibility without sacrificing entropy.
 *   - No "no dictionary words" check. That would require a wordlist
 *     and a leak-database lookup, neither of which is in scope for
 *     this build. (Phase 2 could integrate `haveibeenpwned` style
 *     k-anonymity checks if needed.)
 *   - No maximum length cap. bcrypt truncates at 72 bytes internally,
 *     but the user's password manager can store anything they like;
 *     we don't enforce a UI ceiling because that just frustrates.
 */

export const MIN_PASSWORD_LENGTH = 12;
const REQUIRED_CLASSES = 3; // out of 4

/** Return null when the password is acceptable, otherwise a user-facing error. */
export function validatePasswordPolicy(plaintext: string): string | null {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    return "Password is required.";
  }
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (plaintext !== plaintext.trim()) {
    return "Password must not start or end with whitespace.";
  }

  // Count distinct character classes present.
  const hasLower = /[a-z]/.test(plaintext);
  const hasUpper = /[A-Z]/.test(plaintext);
  const hasDigit = /[0-9]/.test(plaintext);
  // Symbol = anything that is neither letter, digit, nor whitespace.
  const hasSymbol = /[^A-Za-z0-9\s]/.test(plaintext);
  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(
    Boolean,
  ).length;

  if (classes < REQUIRED_CLASSES) {
    return `Password must include at least ${REQUIRED_CLASSES} of: lowercase letter, uppercase letter, digit, special character.`;
  }

  return null;
}
