/** Country code assumed for numbers written without one (10-digit local numbers). */
const DEFAULT_COUNTRY_CODE = '91';

/**
 * Normalises a mobile number to "+<countrycode><number>" so the same person always maps to the
 * same customer regardless of formatting: "98765 43210", "+91-98765-43210", "09876543210" and
 * "919876543210" all become "+919876543210". Returns null if it cannot be a valid number.
 */
export function normalizeMobile(input: string): string | null {
  const s = input.trim();
  if (!/^\+?[0-9\s\-()]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');

  if (s.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+${DEFAULT_COUNTRY_CODE}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY_CODE)) return `+${digits}`;
  return null;
}
