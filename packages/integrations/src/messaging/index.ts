export type {
  HealthStatus,
  MessageChannel,
  MessagingProvider,
  MessagingSendErrorLike,
  OutboundMessage,
  ProviderErrorCategory,
  ProviderEvent,
  SendResult,
} from "./types";
export { createConsoleMessagingProvider, defaultOutbox, MessagingOutbox } from "./console";
export type { OutboxEntry } from "./console";
export { createWaLinkProvider } from "./providers/wa-link";
export {
  createWhatsappCloudProvider,
  classifyWhatsappCloudError,
} from "./providers/whatsapp-cloud";
export type { WhatsappCloudCredentials, WhatsappCloudSendInput } from "./providers/whatsapp-cloud";
export { createOrangeSmsProvider, classifyOrangeSmsError } from "./providers/orange-sms";
export type { OrangeSmsCredentials } from "./providers/orange-sms";
export { createTwilioProvider, classifyTwilioError } from "./providers/twilio";
export type { TwilioCredentials } from "./providers/twilio";
export { createHttpSmsProvider, classifyHttpSmsError } from "./providers/http-sms";
export type { HttpSmsCredentials } from "./providers/http-sms";
export { createResendProvider, classifyResendError } from "./providers/resend";
export type { ResendCredentials } from "./providers/resend";
export { createSmtpProvider, classifySmtpError } from "./providers/smtp";
export type { SmtpCredentials } from "./providers/smtp";
