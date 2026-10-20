// M03 §9 « Worker » — tâches du planning. Toutes tournent toutes les 15 min et décident
// elles-mêmes, organisation par organisation, s'il y a quelque chose à faire (heure locale
// du site atteinte, dédoublonnage par jour), comme `reports` (M12).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const APPOINTMENTS_QUEUE_NAME = "appointments";

export const APPOINTMENTS_JOB_NAMES = {
  MARK_NO_SHOW: "appointments.mark_no_show",
  DAILY_AGENDA: "appointments.daily_agenda",
  UNCONFIRMED_CHECK: "appointments.unconfirmed_check",
} as const;

let queue: Queue | undefined;

export function getAppointmentsQueue(): Queue {
  queue ??= new Queue(APPOINTMENTS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleAppointmentJobs(): Promise<void> {
  const queue = getAppointmentsQueue();
  for (const name of Object.values(APPOINTMENTS_JOB_NAMES)) {
    await queue.upsertJobScheduler(name, { pattern: "*/15 * * * *" }, { name });
  }
}
