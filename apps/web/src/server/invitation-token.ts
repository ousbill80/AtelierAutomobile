import { createHash, randomBytes } from "node:crypto";

export const INVITATION_EXPIRY_DAYS = 7;

export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function computeInvitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}
