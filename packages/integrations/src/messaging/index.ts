export type {
  HealthStatus,
  MessageChannel,
  MessagingProvider,
  OutboundMessage,
  ProviderEvent,
  SendResult,
} from "./types";
export { createConsoleMessagingProvider, defaultOutbox, MessagingOutbox } from "./console";
export type { OutboxEntry } from "./console";
