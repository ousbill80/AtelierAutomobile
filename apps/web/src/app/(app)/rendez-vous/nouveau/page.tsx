"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Card, PageHead } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import "../planning.css";
import { AppointmentForm } from "../_components/AppointmentForm";
import { useActiveSite } from "../_lib/useActiveSite";
import { ToastProvider } from "../_lib/useToast";

export default function NewAppointmentPage() {
  return (
    <ToastProvider>
      <NewAppointmentScreen />
    </ToastProvider>
  );
}

/** `/rendez-vous/nouveau` — formulaire complet avec assistant « Trouver un créneau ». */
function NewAppointmentScreen() {
  const site = useActiveSite();
  const router = useRouter();
  const params = useSearchParams();
  const now = new Date();
  const list = trpc.appointment.list.useQuery(
    { siteId: site.siteId ?? "", from: now, to: new Date(now.getTime() + 1) },
    { enabled: Boolean(site.siteId) },
  );
  return (
    <>
      <PageHead title={t("appointments.newTitle")} />
      <Card>
        {list.isLoading || !list.data || !site.siteId ? (
          <div className="skeleton" style={{ height: 300 }} />
        ) : (
          <AppointmentForm
            siteId={site.siteId}
            timeZone={list.data.timeZone}
            durations={list.data.settings.durations}
            bays={list.data.bays}
            mechanics={list.data.mechanics}
            canForce={site.can("planning:manage")}
            initial={{
              customerId: params.get("customerId") ?? undefined,
              vehicleId: params.get("vehicleId") ?? undefined,
              source: params.get("source") ?? "STAFF",
            }}
            onCreated={(id) => router.push(`/rendez-vous?appointment=${id}`)}
            onCancel={() => router.push("/rendez-vous")}
          />
        )}
      </Card>
    </>
  );
}
