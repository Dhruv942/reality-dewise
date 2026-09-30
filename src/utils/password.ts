import argon2 from 'argon2';

// argon2id with the library's default (OWASP-aligned) cost parameters.
export const hashPassword = (plain: string): Promise<string> =>
  argon2.hash(plain, { type: argon2.argon2id });

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false; // malformed hash => treat as mismatch
  }
}

// Used to keep login timing similar when the email is unknown.
let dummyHash: Promise<string> | undefined;
export const getDummyHash = (): Promise<string> =>
  (dummyHash ??= hashPassword('dummy-password-for-timing-equalisation'));
