"use client";

// Activation des notifications push sur cet appareil : permission du navigateur, abonnement
// au service de push avec la clé VAPID du serveur, enregistrement côté serveur.
import { useEffect, useState } from "react";
import { trpc } from "@/trpc/client";
import { isIos, isStandalone, urlBase64ToUint8Array } from "./pwa-state";

export type PushStatus =
  | "loading"
  | "unsupported" // navigateur sans Web Push
  | "ios-install" // iPhone/iPad : il faut d'abord installer l'appli sur l'écran d'accueil
  | "server-off" // serveur sans clés VAPID
  | "denied" // permission refusée dans le navigateur
  | "off"
  | "on";

function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function usePush() {
  const config = trpc.notifications.push.config.useQuery(undefined, { staleTime: 60_000 });
  const subscribe = trpc.notifications.push.subscribe.useMutation();
  const unsubscribe = trpc.notifications.push.unsubscribe.useMutation();
  const utils = trpc.useUtils();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // État réel de l'abonnement de cet appareil (lu de façon asynchrone au montage).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const registration = pushSupported()
        ? await navigator.serviceWorker.getRegistration()
        : undefined;
      const existing = await registration?.pushManager.getSubscription();
      if (!cancelled) setSubscribed(Boolean(existing));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  let status: PushStatus = "loading";
  if (subscribed === null || config.isLoading) status = "loading";
  else if (!pushSupported()) status = isIos() && !isStandalone() ? "ios-install" : "unsupported";
  else if (!config.data?.enabled || !config.data.publicKey) status = "server-off";
  else if (Notification.permission === "denied") status = "denied";
  else status = subscribed ? "on" : "off";

  async function enable() {
    setError(null);
    if (!config.data?.publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("permission");
        return;
      }
      const registration =
        (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.data.publicKey),
        }));
      const json = subscription.toJSON();
      await subscribe.mutateAsync({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
        userAgent: navigator.userAgent.slice(0, 300),
      });
      await utils.notifications.push.config.invalidate();
      setSubscribed(true);
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setError(null);
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await unsubscribe.mutateAsync({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      await utils.notifications.push.config.invalidate();
      setSubscribed(false);
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  return { status, busy, error, enable, disable, devices: config.data?.devices ?? 0 };
}
