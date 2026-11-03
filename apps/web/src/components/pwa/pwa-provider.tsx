"use client";

// Branche la PWA sur toute l'application : service worker (hors-ligne, push), invitation
// d'installation, réabonnement push quand le navigateur renouvelle l'abonnement.
import { useEffect } from "react";
import { trpc } from "@/trpc/client";
import {
  setInstallPrompt,
  urlBase64ToUint8Array,
  type BeforeInstallPromptEvent,
} from "./pwa-state";

export function PwaProvider() {
  const subscribe = trpc.notifications.push.subscribe.useMutation();
  const config = trpc.notifications.push.config.useQuery(undefined, { staleTime: 5 * 60_000 });
  const publicKey = config.data?.publicKey ?? null;

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // En développement, le service worker gênerait le rechargement à chaud : seulement en prod,
    // sauf demande explicite (NEXT_PUBLIC_PWA_DEV=1) pour tester l'installation et le push.
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_PWA_DEV !== "1") return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Le navigateur a renouvelé l'abonnement (pushsubscriptionchange) : on le réenregistre.
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !publicKey) return;
    const onMessage = async (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type !== "push:resubscribe") return;
      if (Notification.permission !== "granted") return;
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const json = subscription.toJSON();
      subscribe.mutate({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [publicKey, subscribe]);

  return null;
}
