// Récupération de compte SANS email ni SMS : génère, depuis le serveur, un lien à usage unique
// pour choisir un nouveau mot de passe. Utile quand aucun canal plateforme (PLATFORM_EMAIL_*,
// PLATFORM_SMS_*) n'est configuré, ou après la perte du téléphone portant l'application
// d'authentification : la réinitialisation retire aussi l'application (RG-M01-07 bis).
//
// Seul quelqu'un qui a accès au serveur peut lancer cette commande :
//   pnpm --filter @atelieros/worker account:reset-link --email konan@garage.ci
//   pnpm --filter @atelieros/worker account:reset-link --phone "07 08 12 34 56"
import { createHash, randomBytes } from "node:crypto";
import { normalizePhoneCI } from "@atelieros/core";
import { adminDb, writeAuditLog } from "@atelieros/db";

/** Durée de validité du lien (plus longue que l'OTP : il est transmis à la main). */
export const RESET_LINK_EXPIRY_MINUTES = 30;

export type ResetLinkTarget = { kind: "EMAIL"; value: string } | { kind: "PHONE"; value: string };

/** Lit `--email x` ou `--phone x` ; retourne null si la commande est mal formée. */
export function parseResetLinkArgs(argv: readonly string[]): ResetLinkTarget | null {
  const emailIndex = argv.indexOf("--email");
  const phoneIndex = argv.indexOf("--phone");
  if ((emailIndex === -1) === (phoneIndex === -1)) return null;
  if (emailIndex !== -1) {
    const email = argv[emailIndex + 1]?.trim().toLowerCase();
    return email && email.includes("@") ? { kind: "EMAIL", value: email } : null;
  }
  const raw = argv[phoneIndex + 1];
  if (!raw) return null;
  try {
    const { e164 } = normalizePhoneCI(raw);
    return e164 ? { kind: "PHONE", value: e164 } : null;
  } catch {
    return null; // numéro invalide
  }
}

/** Même format et même empreinte que le jeton émis après un OTP « RESET » (auth.verifyOtp). */
export function buildResetToken(userId: string, random: Buffer): { token: string; hash: string } {
  const token = `${userId}.${random.toString("hex")}`;
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

export function buildResetLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/mot-de-passe-oublie?token=${encodeURIComponent(token)}`;
}

async function main() {
  const target = parseResetLinkArgs(process.argv.slice(2));
  if (!target) {
    console.error(
      'Usage : account:reset-link --email <adresse>  |  account:reset-link --phone "<numéro>"',
    );
    process.exit(2);
  }

  const user =
    target.kind === "EMAIL"
      ? await adminDb.user.findUnique({ where: { email: target.value } })
      : await adminDb.user.findUnique({ where: { phone: target.value } });
  if (!user) {
    console.error(`Aucun compte pour ${target.value}.`);
    process.exit(1);
  }

  const now = new Date();
  const { token, hash } = buildResetToken(user.id, randomBytes(24));
  await adminDb.verification.create({
    data: {
      identifier: `RESET_TOKEN:${user.id}`,
      value: hash,
      attempts: 0,
      expiresAt: new Date(now.getTime() + RESET_LINK_EXPIRY_MINUTES * 60_000),
    },
  });

  const memberships = await adminDb.membership.findMany({
    where: { userId: user.id, isActive: true },
  });
  await Promise.all(
    memberships.map((membership) =>
      writeAuditLog({
        organizationId: membership.organizationId,
        userId: user.id,
        membershipId: membership.id,
        action: "auth.reset_link_issued",
        entity: "User",
        entityId: user.id,
        reason: "Lien de réinitialisation généré depuis le serveur",
      }),
    ),
  );

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  console.log(`Compte : ${user.name} (${target.value})`);
  console.log(`Lien valable ${RESET_LINK_EXPIRY_MINUTES} minutes, utilisable une seule fois :`);
  console.log(buildResetLink(appUrl, token));
  console.log(
    "Transmettez-le directement à la personne (pas par un canal public). Il retire aussi l'application d'authentification.",
  );
  await adminDb.$disconnect();
}

// Exécuté seulement en ligne de commande (les tests importent les fonctions pures).
if (process.argv[1]?.endsWith("account-reset-link.ts")) {
  main().catch(async (error: unknown) => {
    console.error(error);
    await adminDb.$disconnect();
    process.exit(1);
  });
}
