"use client";

// /parametres — page d'entrée : redirige vers la première page de paramètres autorisée.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ListSkeleton } from "@/components/repair-orders/error-box";
import { trpc } from "@/trpc/client";
import { firstSettingsHref } from "./settings-nav";

export default function SettingsIndexPage() {
  const router = useRouter();
  const me = trpc.me.get.useQuery();
  useEffect(() => {
    if (!me.data) return;
    router.replace(firstSettingsHref(new Set(me.data.permissions)) ?? "/");
  }, [me.data, router]);
  return <ListSkeleton rows={4} />;
}
