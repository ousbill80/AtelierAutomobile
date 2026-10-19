import { defaultOutbox, type MessagingOutbox } from "@atelieros/integrations";

// Outbox partagé par défaut entre tous les providers `console` du processus (OTP, M11…),
// lu par /dev/outbox et alimenté par createConsoleMessagingProvider (messaging/console.ts).
export const devOutbox: MessagingOutbox = defaultOutbox;
