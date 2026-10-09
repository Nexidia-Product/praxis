/**
 * Outcome product / type vocabularies — pure helpers (no I/O, client-safe).
 *
 * The lists live on the settings singleton (`outcome_products` /
 * `outcome_types`) and are managed at Admin → Configuration → Outcomes. The
 * project form can also add a value inline; the server appends it to the
 * stored list with `appendOutcomeValue` so concurrent additions by different
 * admins don't overwrite each other.
 */

export const MAX_OUTCOME_VALUE_LEN = 100;

export type AppendResult =
  | { ok: true; list: string[]; value: string; added: boolean }
  | { ok: false; error: string };

/**
 * Add `raw` to `list`. Trimmed; blank and over-long values are rejected. A
 * value already in the list (ignoring case) isn't added twice: the existing
 * spelling is returned so the caller selects that one.
 */
export function appendOutcomeValue(list: string[], raw: unknown): AppendResult {
  if (typeof raw !== "string") return { ok: false, error: "value must be a string." };
  const value = raw.trim();
  if (!value) return { ok: false, error: "Enter a value to add." };
  if (value.length > MAX_OUTCOME_VALUE_LEN) {
    return {
      ok: false,
      error: `Values must be ${MAX_OUTCOME_VALUE_LEN} characters or fewer.`,
    };
  }
  const existing = list.find((v) => v.toLowerCase() === value.toLowerCase());
  if (existing) return { ok: true, list, value: existing, added: false };
  return { ok: true, list: [...list, value], value, added: true };
}
