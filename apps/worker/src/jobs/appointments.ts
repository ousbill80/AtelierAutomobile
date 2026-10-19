/**
 * Tâches planifiées M03 (§9) : `appointments.mark_no_show` (toutes les 15 min, RG-M03-10),
 * `appointments.unconfirmed_check` (18:00 heure locale, « Appels à passer »),
 * `appointments.daily_agenda` (07:00 heure locale). La logique vit dans `@atelieros/planning` ;
 * ce fichier ne fait que planifier et exécuter (CLAUDE.md : « jobs ne font qu'orchestrer »).
 * Les deux tâches « horaires » sont déclenchées toutes les 15 min et décident elles-mêmes,
 * organisation par organisation, si l'heure locale est atteinte (dédoublonnage par jour).
 */
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { runDailyAgendaJob, runNoShowJob, runUnconfirmedCheckJob } from "@atelieros/planning";
import { logger } from "../logger";

export const APPOINTMENTS_QUEUE_NAME = "appointments";

type AppointmentsJobName = "mark_no_show" | "unconfirmed_check" | "daily_agenda";

function parseRedisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    password: parsed.password || undefined,
  };
}

export async function runAppointmentsJob(name: AppointmentsJobName) {
  switch (name) {
    case "mark_no_show":
      return runNoShowJob();
    case "unconfirmed_check":
      return runUnconfirmedCheckJob();
    case "daily_agenda":
      return runDailyAgendaJob();
  }
}

/** Démarre le worker et planifie les tâches répétées. Retourne les instances pour un arrêt propre. */
export async function startAppointmentsWorker(): Promise<{ worker: Worker; queue: Queue }> {
  const connection = parseRedisConnection(process.env.REDIS_URL ?? "redis://localhost:6380");
  const queue = new Queue(APPOINTMENTS_QUEUE_NAME, { connection });

  const schedules: Array<{ name: AppointmentsJobName; pattern: string }> = [
    { name: "mark_no_show", pattern: "*/15 * * * *" },
    { name: "unconfirmed_check", pattern: "*/15 * * * *" },
    { name: "daily_agenda", pattern: "*/15 * * * *" },
  ];
  for (const schedule of schedules) {
    await queue.upsertJobScheduler(
      `appointments.${schedule.name}`,
      { pattern: schedule.pattern },
      { name: schedule.name, data: {} },
    );
  }

  const worker = new Worker(
    APPOINTMENTS_QUEUE_NAME,
    async (job) => {
      const report = await runAppointmentsJob(job.name as AppointmentsJobName);
      logger.info({ job: job.name, ...report }, "appointments: tâche exécutée");
    },
    { connection },
  );
  worker.on("failed", (job, err) => {
    logger.error({ job: job?.name, err }, "appointments: tâche en échec");
  });
  return { worker, queue };
}
