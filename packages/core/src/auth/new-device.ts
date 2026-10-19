import type { Role } from "./permissions";

// RG-M01-07 : rôles pour lesquels un OTP est requis sur un appareil non approuvé, par défaut.
export const DEFAULT_OTP_ON_NEW_DEVICE_ROLES: Role[] = ["OWNER", "ACCOUNTANT"];

export const TRUSTED_DEVICE_APPROVAL_DAYS = 90;

export interface SecuritySettingsLike {
  otpOnNewDevice?: Role[];
}

export function requiresNewDeviceOtp(
  settings: SecuritySettingsLike | null | undefined,
  role: Role,
): boolean {
  const roles = settings?.otpOnNewDevice ?? DEFAULT_OTP_ON_NEW_DEVICE_ROLES;
  return roles.includes(role);
}

export function computeTrustedDeviceExpiry(now: Date): Date {
  return new Date(now.getTime() + TRUSTED_DEVICE_APPROVAL_DAYS * 24 * 60 * 60 * 1000);
}
