"use client";

// §7 `/(app)/rendez-vous/nouveau` — formulaire complet sur une colonne, avec « Trouver un
// créneau » et suggestion. Préremplissage par paramètres d'URL (ex. depuis une conversation
// M11 ou la file des relances : ?customerId=…&vehicleId=…&type=INSPECTION_PREP&source=REMINDER&reminderId=…).
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar } from "lucide-react";
import { FormCard } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { AppointmentForm } from "../appointment-form";
import { SOURCES, TYPES, ta, type AppointmentSource, type AppointmentType } from "../labels";
import { Toast, type ToastState } from "../ui-bits";

function NewAppointment() {
  const router = useRouter();
  const params = useSearchParams();
  const me = trpc.me.get.useQuery();
  const [toast, setToast] = useState<ToastState>(null);
  const type = params.get("type");
  const source = params.get("source");
  const startsAt = params.get("startsAt");
  const tz = me.data?.activeOrganization?.timezone ?? "Africa/Abidjan";

  return (
    <FormCard
      icon={<Calendar className="size-5" />}
      title={ta("form.title")}
      description="Planifiez une intervention dans l'atelier avec créneau horaire, durée, pont et mécanicien assigné"
      badge="Nouveau rendez-vous"
      backHref="/rendez-vous"
      backLabel="Retour au planning"
      maxWidth="xl"
    >
      <AppointmentForm
        timeZone={tz}
        initial={{
          customerId: params.get("customerId") ?? undefined,
          vehicleId: params.get("vehicleId"),
          type: TYPES.includes(type as AppointmentType) ? (type as AppointmentType) : undefined,
          source: SOURCES.includes(source as AppointmentSource)
            ? (source as AppointmentSource)
            : undefined,
          reminderId: params.get("reminderId"),
          startsAt: startsAt ? new Date(startsAt) : undefined,
        }}
        onCancel={() => router.push("/rendez-vous")}
        onDone={(result) => {
          setToast({
            message: result.notified ? ta("form.created") : ta("form.createdNoChannel"),
            tone: "ok",
          });
          router.push("/rendez-vous");
        }}
      />
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </FormCard>
  );
}

export default function NewAppointmentPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Chargement…</p>}>
      <NewAppointment />
    </Suspense>
  );
}
