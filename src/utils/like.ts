/** Escapes `\`, `%` and `_` so user input is matched literally inside an ILIKE pattern. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');
