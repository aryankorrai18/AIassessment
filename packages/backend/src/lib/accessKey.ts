import { randomInt } from "node:crypto";

// CSPRNG-backed. 32 chars: no I, O, 0, 1 (easily confused when read from an email).
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 12;

export function generateAccessKey(): string {
  let key = "";
  for (let i = 0; i < LENGTH; i++) key += CHARS[randomInt(CHARS.length)];
  return key;
}
