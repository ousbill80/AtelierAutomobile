export type {
  HealthStatus,
  MessageChannel,
  MessagingProvider,
  MessagingSendErrorLike,
  OutboundMessage,
  OutboxEntry,
  ProviderErrorCategory,
  ProviderEvent,
  ProviderMessageStatus,
  SendResult,
} from "./messaging";
export { createConsoleMessagingProvider, defaultOutbox, MessagingOutbox } from "./messaging";
export { createWaLinkProvider } from "./messaging";
export { createWhatsappCloudProvider, classifyWhatsappCloudError } from "./messaging";
export type { WhatsappCloudCredentials, WhatsappCloudSendInput } from "./messaging";
export { createOrangeSmsProvider, classifyOrangeSmsError } from "./messaging";
export type { OrangeSmsCredentials } from "./messaging";
export { createTwilioProvider, classifyTwilioError } from "./messaging";
export type { TwilioCredentials } from "./messaging";
export { createHttpSmsProvider, classifyHttpSmsError } from "./messaging";
export type { HttpSmsCredentials } from "./messaging";
export { createResendProvider, classifyResendError } from "./messaging";
export type { ResendCredentials } from "./messaging";
export { createSmtpProvider, classifySmtpError } from "./messaging";
export type { SmtpCredentials } from "./messaging";

export { decryptSecret, encryptSecret, loadEncryptionKey } from "./encryption";

export type {
  CreatePaymentLinkInput,
  CreatePaymentLinkResult,
  OnlinePaymentMethod,
  PaymentEvent,
  PaymentProvider,
  PaymentStatus,
  PaymentStatusResult,
} from "./payment/provider";
export { hmacSha256Hex, PaymentProviderError, safeEqualHex } from "./payment/provider";
export { createInMemoryManualPaymentLedger, ManualPaymentProvider } from "./payment/manual";
export type { ManualPaymentLedger, ManualPaymentRecord } from "./payment/manual";
export {
  createInMemorySimulatorLedger,
  defaultSimulatorLedger,
  FakePaymentProvider,
  SIMULATOR_SIGNATURE_HEADER,
} from "./payment/fake";
export type { SimulatedOutcome, SimulatedPayment, SimulatorLedger } from "./payment/fake";
export { CinetPayProvider, cinetPayMethod } from "./payment/cinetpay";
export type { CinetPayCredentials } from "./payment/cinetpay";
export { WaveProvider } from "./payment/wave";
export type { WaveCredentials } from "./payment/wave";

export type {
  FneCertifyResult,
  FneHealthStatus,
  FneInvoicePayload,
  FneProvider,
} from "./fne/provider";
export { FneProviderError } from "./fne/provider";
export { ManualFneProvider } from "./fne/manual";
export { FakeFneProvider } from "./fne/fake";
export type { FakeFneOptions } from "./fne/fake";
export { DgiApiFneProvider } from "./fne/dgi-api";
export type { DgiApiCredentials, FetchLike } from "./fne/dgi-api";

export type {
  FneConfigRecord,
  FneConfigStore,
  MessagingConfigRecord,
  MessagingConfigStore,
  PaymentConfigRecord,
  PaymentConfigStore,
} from "./registry/types";
export { isLocalProvider } from "./registry/types";
export { resolveMessagingProvider } from "./registry/messaging";
export type { MessagingRegistryDeps } from "./registry/messaging";
export {
  buildPaymentProvider,
  PAYMENT_CREDENTIAL_FIELDS,
  PAYMENT_PROVIDERS,
  resolvePaymentProvider,
} from "./registry/payment";
export type { PaymentProviderName } from "./registry/payment";
export type { PaymentRegistryDeps } from "./registry/payment";
export { resolveFneProvider } from "./registry/fne";
export type { FneRegistryDeps } from "./registry/fne";

export { assertUploadable, createS3ObjectStorage, S3ObjectStorage } from "./storage";
export type { S3ObjectStorageConfig, UploadInput } from "./storage";

export type {
  ExternalDatabase,
  ExternalDbConfig,
  ExternalDbType,
  ExternalQueryResult,
  ExternalTestResult,
  MemoryQueryHandler,
} from "./externalDb";
export {
  cellToText,
  createExternalDatabase,
  createMemoryExternalDatabase,
  friendlyExternalDbError,
} from "./externalDb";

export { LocalObjectStorage } from "./storage-local";
export type { BinaryObjectStorage } from "./storage-local";

export * from "./ai";

export {
  FakeWebhookSender,
  generateApiKey,
  generateWebhookSecret,
  HttpWebhookSender,
  requestFingerprint,
  resolveWebhookSender,
  sha256Hex,
  signWebhook,
  webhookHmac,
} from "./webhooks";
export type {
  FakeResponder,
  FakeWebhookRecord,
  HostResolver,
  WebhookRequest,
  WebhookResponse,
  WebhookSender,
} from "./webhooks";

export * from "./subscription";
