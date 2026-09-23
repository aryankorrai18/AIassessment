import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

export const hashSecret = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const compareSecret = (plain: string, hash: string) => (hash ? bcrypt.compare(plain, hash) : Promise.resolve(false));

// Refresh tokens are high-entropy signed values, not human-chosen secrets, so a
// fast SHA-256 + constant-time compare is appropriate (bcrypt would add nothing).
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function tokenMatchesHash(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const hashSecretSync = (plain: string) => bcrypt.hashSync(plain, BCRYPT_ROUNDS);
