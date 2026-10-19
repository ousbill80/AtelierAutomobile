import { createInMemoryOutbox, type Outbox } from "@atelieros/integrations";

// Un seul outbox par processus (évite de le réinitialiser au rechargement à chaud de
// Next.js en développement), lu par /dev/outbox et alimenté par ConsoleMessagingProvider.
const globalForOutbox = globalThis as unknown as { atelierOSOutbox?: Outbox };

export const devOutbox: Outbox = globalForOutbox.atelierOSOutbox ?? createInMemoryOutbox();

if (process.env.NODE_ENV !== "production") {
  globalForOutbox.atelierOSOutbox = devOutbox;
}
