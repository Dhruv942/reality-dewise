import { ValidationError } from './errors';

/** Normalizes Indian mobile numbers to their 10 digits ("+91 98765-43210" -> "9876543210"). */
export function normalizeMobile(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^\d{10}$/.test(digits)) throw new ValidationError(`Invalid mobile number: ${raw}`);
  return digits;
}
