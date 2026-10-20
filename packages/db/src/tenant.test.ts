import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "./client";
import { db, forTenant, MissingTenantContextError, TenantIsolationViolationError } from "./tenant";

// Test obligatoire (01-architecture-technique.md §3) : un utilisateur de l'organisation A
// ne peut lire, modifier, ni deviner (énumération d'ID) aucune donnée de l'organisation B.
describe("db.forTenant — isolation multi-locataire A/B", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let customerA: { id: string };
  let customerB: { id: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Test Tenant A" } });
    orgB = await adminDb.organization.create({ data: { name: "Test Tenant B" } });
    customerA = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Client A", type: "INDIVIDUAL" },
    });
    customerB = await adminDb.customer.create({
      data: { organizationId: orgB.id, displayName: "Client B", type: "INDIVIDUAL" },
    });
  });

  afterAll(async () => {
    await adminDb.customer.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await adminDb.$disconnect();
  });

  it("lève MissingTenantContextError sans organizationId", () => {
    expect(() => forTenant({ organizationId: "" })).toThrow(MissingTenantContextError);
  });

  it("findMany ne retourne que les lignes de l'organisation active", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    const rows = await clientA.customer.findMany({});
    expect(rows.every((row) => row.organizationId === orgA.id)).toBe(true);
    expect(rows.some((row) => row.id === customerA.id)).toBe(true);
    expect(rows.some((row) => row.id === customerB.id)).toBe(false);
  });

  it("findUnique sur un ID d'une autre organisation ne renvoie rien (pas de fuite)", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    const found = await clientA.customer.findUnique({ where: { id: customerB.id } });
    expect(found).toBeNull();
  });

  it("findUniqueOrThrow sur un ID d'une autre organisation lève une erreur plutôt que de le renvoyer", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    await expect(
      clientA.customer.findUniqueOrThrow({ where: { id: customerB.id } }),
    ).rejects.toThrow();
  });

  it("énumération d'ID impossible : findUnique sur l'ID réel de B via le client de A échoue silencieusement", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    const clientB = db.forTenant({ organizationId: orgB.id });
    // Le client légitime de B voit bien sa propre ligne...
    const ownRow = await clientB.customer.findUnique({ where: { id: customerB.id } });
    expect(ownRow?.id).toBe(customerB.id);
    // ...mais le client de A, avec le même ID deviné, n'obtient rien.
    const leaked = await clientA.customer.findUnique({ where: { id: customerB.id } });
    expect(leaked).toBeNull();
  });

  it("update sur un ID d'une autre organisation lève TenantIsolationViolationError et ne modifie rien", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    await expect(
      clientA.customer.update({ where: { id: customerB.id }, data: { notes: "compromis" } }),
    ).rejects.toThrow(TenantIsolationViolationError);

    const untouched = await adminDb.customer.findUniqueOrThrow({ where: { id: customerB.id } });
    expect(untouched.notes).toBeNull();
  });

  it("updateMany sur un filtre recoupant une autre organisation ne modifie que ses propres lignes (count = 0 si aucune cible)", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    const result = await clientA.customer.updateMany({
      where: { id: customerB.id },
      data: { notes: "compromis" },
    });
    expect(result.count).toBe(0);

    const untouched = await adminDb.customer.findUniqueOrThrow({ where: { id: customerB.id } });
    expect(untouched.notes).toBeNull();
  });

  it("delete sur un ID d'une autre organisation lève TenantIsolationViolationError et ne supprime rien", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    await expect(clientA.customer.delete({ where: { id: customerB.id } })).rejects.toThrow(
      TenantIsolationViolationError,
    );

    const stillThere = await adminDb.customer.findUnique({ where: { id: customerB.id } });
    expect(stillThere).not.toBeNull();
  });

  it("create force toujours organizationId, même si un autre id est fourni dans data", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    const created = await clientA.customer.create({
      data: {
        displayName: "Client injecté",
        type: "INDIVIDUAL",
        organizationId: orgB.id, // tentative de contournement
      },
    });
    expect(created.organizationId).toBe(orgA.id);
  });

  it("upsert bloque la mise à jour d'un enregistrement existant d'une autre organisation", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    await expect(
      clientA.customer.upsert({
        where: { id: customerB.id },
        create: {
          displayName: "Ne doit pas être créé",
          type: "INDIVIDUAL",
          organizationId: orgA.id,
        },
        update: { notes: "compromis" },
      }),
    ).rejects.toThrow(TenantIsolationViolationError);
  });

  it("catalogue global (RG-M02-20) : une lecture voit les lignes organizationId=null en plus des siennes", async () => {
    const globalMake = await adminDb.vehicleMake.create({
      data: { organizationId: null, name: `Toyota-${orgA.id}` },
    });
    const clientA = db.forTenant({ organizationId: orgA.id });
    try {
      const ownMake = await clientA.vehicleMake.create({
        data: { name: `MarqueLocaleA-${orgA.id}` },
      });

      const rows = await clientA.vehicleMake.findMany({
        where: { name: { in: [globalMake.name, ownMake.name] } },
      });
      expect(rows.map((r) => r.name).sort()).toEqual([globalMake.name, ownMake.name].sort());

      // Mais le catalogue global reste strictement en lecture : une organisation ne peut pas le modifier.
      await expect(
        clientA.vehicleMake.update({ where: { id: globalMake.id }, data: { isActive: false } }),
      ).rejects.toThrow(TenantIsolationViolationError);
    } finally {
      await adminDb.vehicleMake.deleteMany({ where: { name: { contains: orgA.id } } });
    }
  });

  it("transaction() — plusieurs opérations tenant-scopées dans une seule transaction Postgres (RG-M02-08)", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    const extra = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "À fusionner A", type: "INDIVIDUAL" },
    });

    const result = await clientA.transaction(async (tx) => {
      const found = await tx.customer.findMany({ where: { id: { in: [extra.id, customerB.id] } } });
      // La lecture, dans la transaction, respecte le même filtrage que forTenant() hors transaction :
      // seule la ligne de A ressort, jamais celle de B.
      expect(found.map((c) => c.id)).toEqual([extra.id]);

      const updated = await tx.customer.update({
        where: { id: extra.id },
        data: { notes: "fusionné dans la transaction" },
      });
      return updated;
    });

    expect(result.notes).toBe("fusionné dans la transaction");

    // Toujours bloqué pour une ligne d'une autre organisation, même à l'intérieur de transaction().
    await expect(
      clientA.transaction((tx) =>
        tx.customer.update({ where: { id: customerB.id }, data: { notes: "x" } }),
      ),
    ).rejects.toThrow(TenantIsolationViolationError);

    await adminDb.customer.delete({ where: { id: extra.id } });
  });

  it("la Row Level Security Postgres bloque aussi un accès direct au rôle restreint, même en contournant l'extension Prisma", async () => {
    // Ceinture et bretelles (01 §3) : la policy RLS doit tenir à elle seule, indépendamment
    // de packages/db/src/tenant.ts. On se connecte ici avec le rôle restreint "atelieros_app"
    // (sans BYPASSRLS) directement, sans passer par forTenant().
    const rawAppDb = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_APP_URL } },
    });
    try {
      // Sans `SET app.organization_id`, la policy ne reconnaît aucune organisation : rien n'est visible.
      const withoutContext = await rawAppDb.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Customer" WHERE id IN (${customerA.id}, ${customerB.id})
      `;
      expect(withoutContext.length).toBe(0);

      // Avec le contexte positionné sur A, seule la ligne de A redevient visible.
      await rawAppDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${orgA.id}, true)`;
        const withContext = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Customer" WHERE id IN (${customerA.id}, ${customerB.id})
        `;
        expect(withContext).toEqual([{ id: customerA.id }]);
      });
    } finally {
      await rawAppDb.$disconnect();
    }
  });

  it("queryRaw() — agrégat SQL sous RLS : une requête sans filtre ne voit que l'organisation courante (M12)", async () => {
    const clientA = db.forTenant({ organizationId: orgA.id });
    const rows = await clientA.queryRaw<{ id: string }>(
      Prisma.sql`SELECT id FROM "Customer" WHERE id IN (${customerA.id}, ${customerB.id})`,
    );
    expect(rows).toEqual([{ id: customerA.id }]);
    await expect(clientA.queryRaw(Prisma.sql`DELETE FROM "Customer"`)).rejects.toThrow(/SELECT/);
  });
});
