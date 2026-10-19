import { hash, verify } from "@node-rs/argon2";

// RG-M01-03 : mots de passe hachés en argon2id. Utilisé à la fois par Better Auth
// (apps/web) et par le seed de démo (packages/db/prisma/seed.ts) pour rester cohérents.
// Algorithm.Argon2id = 2 (@node-rs/argon2) : valeur littérale, l'enum est `const enum`
// ambiant et ne peut pas être importé sous isolatedModules (TS2748).
const ARGON2ID = 2;

export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID });
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}
