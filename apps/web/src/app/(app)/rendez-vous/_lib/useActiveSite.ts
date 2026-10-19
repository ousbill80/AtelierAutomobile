"use client";

import { trpc } from "@/trpc/client";

/** Site de travail du planning : site actif de la session, sinon premier site autorisé. */
export function useActiveSite() {
  const me = trpc.me.get.useQuery();
  const sites = me.data?.allowedSites ?? [];
  const siteId =
    me.data?.activeSiteId && sites.some((s) => s.id === me.data?.activeSiteId)
      ? me.data.activeSiteId
      : (sites[0]?.id ?? null);
  const permissions = new Set<string>(me.data?.permissions ?? []);
  return {
    isLoading: me.isLoading,
    siteId,
    sites,
    permissions,
    membershipId: me.data?.membership?.id ?? null,
    can: (permission: string) => permissions.has(permission),
  };
}
