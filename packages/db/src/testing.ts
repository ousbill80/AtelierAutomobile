import { Prisma } from "@prisma/client";
import { adminDb } from "./client";

// Nettoyage des organisations créées par un test (intégration ou E2E), limité à ces seules
// organisations : toutes les tables rattachées sont vidées par passes successives (l'ordre des
// clés étrangères est résolu en réessayant ce qui a échoué), puis sessions, utilisateurs et
// organisations. Jamais utilisé par le code applicatif.

const TENANT_MODELS = Prisma.dmmf.datamodel.models
  .filter((model) => model.fields.some((field) => field.name === "organizationId"))
  .map((model) => model.name.charAt(0).toLowerCase() + model.name.slice(1));

type DeleteMany = { deleteMany: (args: unknown) => Promise<unknown> };

export async function deleteTestOrganizations(
  organizationIds: string[],
  userIds: string[] = [],
): Promise<void> {
  if (organizationIds.length === 0 && userIds.length === 0) return;
  const client = adminDb as unknown as Record<string, DeleteMany>;
  let remaining = [...TENANT_MODELS];
  for (let pass = 0; pass < 10 && remaining.length > 0; pass++) {
    const failed: string[] = [];
    for (const delegate of remaining) {
      try {
        await client[delegate]!.deleteMany({ where: { organizationId: { in: organizationIds } } });
      } catch {
        failed.push(delegate);
      }
    }
    remaining = failed;
  }
  if (remaining.length > 0) {
    throw new Error(`Nettoyage incomplet des organisations de test : ${remaining.join(", ")}`);
  }
  await adminDb.session.deleteMany({
    where: { OR: [{ activeOrganizationId: { in: organizationIds } }, { userId: { in: userIds } }] },
  });
  await adminDb.account.deleteMany({ where: { userId: { in: userIds } } });
  await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
  await adminDb.organization.deleteMany({ where: { id: { in: organizationIds } } });
}
