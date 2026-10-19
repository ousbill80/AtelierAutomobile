const STORAGE_KEY = "atelieros:activeOrgId";

/** Dernière organisation active connue côté client, envoyée en x-org-id (US-M01-10). */
export function getStoredActiveOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredActiveOrgId(orgId: string | null): void {
  if (typeof window === "undefined") return;
  if (orgId) {
    window.localStorage.setItem(STORAGE_KEY, orgId);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
