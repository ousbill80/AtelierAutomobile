// M15 RG-M15-17 / §8 `paymentProviders.*` — `/parametres/paiements` : fournisseurs de liens de
// paiement (CinetPay, Wave Business, simulateur hors production), moyens couverts, test, et
// numéros marchands affichés quand aucun fournisseur n'est actif. Les identifiants sont chiffrés
// (AES-256-GCM), jamais renvoyés au navigateur ni écrits dans l'audit (« [secret modifié] »).
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { billingSettingsFrom, isDomainError } from "@atelieros/core";
import { adminDb, db, type Prisma } from "@atelieros/db";
import {
  decryptSecret,
  encryptSecret,
  loadEncryptionKey,
  PAYMENT_CREDENTIAL_FIELDS,
  PaymentProviderError,
  type PaymentProviderName,
} from "@atelieros/integrations";
import {
  merchantNumbersInputSchema,
  paymentProviderInputSchema,
  setPaymentProviderActiveInputSchema,
  upsertPaymentProviderInputSchema,
} from "@atelieros/validators";
import { actorOf } from "../billing/context";
import { paymentWebhookUrl, providerFromConfig } from "../billing/paymentLinks";
import { audit, bad, billingNow } from "../billing/service";
import { appUrl } from "../appointments/service";
import { requirePermission, router } from "../trpc";

const PROVIDERS: PaymentProviderName[] = ["cinetpay", "wave", "fake"];

function simulatorAllowed(): boolean {
  return process.env.APP_ENV !== "production";
}

function readCredentials(encrypted: string | null | undefined): Record<string, string> {
  if (!encrypted) return {};
  try {
    return JSON.parse(decryptSecret(encrypted, loadEncryptionKey())) as Record<string, string>;
  } catch {
    return {};
  }
}

function missingFields(provider: PaymentProviderName, credentials: Record<string, string>) {
  return PAYMENT_CREDENTIAL_FIELDS[provider].filter((f) => !credentials[f]);
}

export const paymentProvidersRouter = router({
  list: requirePermission("settings:payments").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const [configs, org] = await Promise.all([
      tenantDb.paymentProviderConfig.findMany({}),
      adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { settings: true },
      }),
    ]);
    return {
      simulatorAllowed: simulatorAllowed(),
      merchantNumbers: billingSettingsFrom(org.settings).merchantNumbers,
      providers: PROVIDERS.filter((p) => p !== "fake" || simulatorAllowed()).map((provider) => {
        const config = configs.find((c) => c.provider === provider);
        const credentials = readCredentials(config?.credentials);
        return {
          provider,
          configured: !!config,
          isActive: config?.isActive ?? false,
          methods: config?.methods ?? [],
          // Noms des champs renseignés seulement : jamais leur valeur.
          fields: PAYMENT_CREDENTIAL_FIELDS[provider].map((name) => ({
            name,
            filled: !!credentials[name],
          })),
          lastTestedAt: config?.lastTestedAt ?? null,
          lastTestOk: config?.lastTestOk ?? null,
          lastError: config?.lastError ?? null,
          webhookUrl: paymentWebhookUrl(provider, ctx.organizationId),
        };
      }),
    };
  }),

  upsert: requirePermission("settings:payments")
    .input(upsertPaymentProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.provider === "fake" && !simulatorAllowed()) {
        bad("Le simulateur de paiement est interdit en production : configurez CinetPay ou Wave.");
      }
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.paymentProviderConfig.findFirst({
        where: { provider: input.provider },
      });
      const allowed = new Set(PAYMENT_CREDENTIAL_FIELDS[input.provider]);
      const previous = readCredentials(existing?.credentials);
      const changed = Object.entries(input.credentials).filter(
        ([k, v]) => allowed.has(k) && v.trim() !== "",
      );
      const credentials: Record<string, string> = { ...previous };
      for (const [k, v] of changed) credentials[k] = v.trim();
      // Simulateur : secret de signature généré côté serveur (jamais saisi).
      if (input.provider === "fake" && !credentials.webhookSecret) {
        credentials.webhookSecret = randomBytes(24).toString("base64url");
      }
      const missing = missingFields(input.provider, credentials);
      if (input.isActive && missing.length > 0) {
        bad("Renseignez tous les identifiants avant d'activer ce fournisseur.");
      }
      const data = {
        methods: input.methods,
        isActive: input.isActive,
        credentials: encryptSecret(JSON.stringify(credentials), loadEncryptionKey()),
        ...(changed.length > 0 ? { lastTestedAt: null, lastTestOk: null, lastError: null } : {}),
      };
      const saved = existing
        ? await tenantDb.paymentProviderConfig.update({ where: { id: existing.id }, data })
        : await tenantDb.paymentProviderConfig.create({
            data: { organizationId: ctx.organizationId, provider: input.provider, ...data },
          });
      await audit(actorOf(ctx), "payment_provider.updated", "PaymentProviderConfig", saved.id, {
        before: existing
          ? { provider: existing.provider, isActive: existing.isActive, methods: existing.methods }
          : null,
        after: {
          provider: saved.provider,
          isActive: saved.isActive,
          methods: saved.methods,
          ...(changed.length > 0 ? { credentials: "[secret modifié]" } : {}),
        },
      });
      return { provider: saved.provider, isActive: saved.isActive, missing };
    }),

  setActive: requirePermission("settings:payments")
    .input(setPaymentProviderActiveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const config = await tenantDb.paymentProviderConfig.findFirst({
        where: { provider: input.provider },
      });
      if (!config) bad("Configurez d'abord ce fournisseur.");
      if (input.isActive) {
        if (input.provider === "fake" && !simulatorAllowed()) {
          bad("Le simulateur de paiement est interdit en production.");
        }
        if (missingFields(input.provider, readCredentials(config.credentials)).length > 0) {
          bad("Renseignez tous les identifiants avant d'activer ce fournisseur.");
        }
      }
      const saved = await tenantDb.paymentProviderConfig.update({
        where: { id: config.id },
        data: { isActive: input.isActive },
      });
      await audit(actorOf(ctx), "payment_provider.activated", "PaymentProviderConfig", saved.id, {
        before: { isActive: config.isActive },
        after: { isActive: saved.isActive },
      });
      return { provider: saved.provider, isActive: saved.isActive };
    }),

  /** RG-M15-17 — test : création d'un lien de 100 FCFA (aucune facture ; il expire seul). */
  test: requirePermission("settings:payments")
    .input(paymentProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const config = await tenantDb.paymentProviderConfig.findFirst({
        where: { provider: input.provider },
      });
      if (!config) bad("Configurez d'abord ce fournisseur.");
      const now = billingNow();
      let ok = true;
      let error: string | null = null;
      try {
        const provider = providerFromConfig(config);
        await provider.createPaymentLink({
          invoiceId: "test",
          reference: "TEST-ATELIEROS",
          amount: 100,
          customer: { name: "Test AtelierOS" },
          expiresAt: new Date(now.getTime() + 3_600_000),
          description: "Test de connexion AtelierOS",
          returnUrl: `${appUrl()}/p/paiement-retour`,
          notifyUrl: paymentWebhookUrl(input.provider, ctx.organizationId),
        });
      } catch (e) {
        ok = false;
        error =
          e instanceof PaymentProviderError || e instanceof TRPCError || isDomainError(e)
            ? (e as Error).message
            : "Échec du test : vérifiez les identifiants.";
      }
      await tenantDb.paymentProviderConfig.update({
        where: { id: config.id },
        data: { lastTestedAt: now, lastTestOk: ok, lastError: error },
      });
      await audit(actorOf(ctx), "payment_provider.tested", "PaymentProviderConfig", config.id, {
        after: { ok },
      });
      return { ok, error };
    }),

  /** Numéros marchands manuels (`settings.payments.merchantNumbers`). */
  updateMerchantNumbers: requirePermission("settings:payments")
    .input(merchantNumbersInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { settings: true },
      });
      const settings = (org.settings ?? {}) as Record<string, unknown>;
      const payments = (settings.payments ?? {}) as Record<string, unknown>;
      const before = billingSettingsFrom(org.settings).merchantNumbers;
      const merchantNumbers = {
        wave: input.wave || null,
        orangeMoney: input.orangeMoney || null,
        mtn: input.mtn || null,
        moov: input.moov || null,
      };
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: {
          settings: {
            ...settings,
            payments: { ...payments, merchantNumbers },
          } as Prisma.InputJsonValue,
        },
      });
      await audit(actorOf(ctx), "settings.payments", "Organization", ctx.organizationId, {
        before: { merchantNumbers: before },
        after: { merchantNumbers },
      });
      return merchantNumbers;
    }),
});
