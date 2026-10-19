import { db } from "@atelieros/db";
import { searchGlobalInputSchema } from "@atelieros/validators";
import { orgProcedure, router } from "../trpc";
import { searchCustomers, searchVehicles } from "../customers/trigram";

/** RG-M02-19 — recherche globale : clients, véhicules, documents, groupés (5 max/groupe). */
export const searchRouter = router({
  global: orgProcedure.input(searchGlobalInputSchema).query(async ({ ctx, input }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const q = input.q.trim();

    const [customers, vehicles] = await Promise.all([
      searchCustomers(ctx.organizationId, q, input.limit),
      searchVehicles(ctx.organizationId, q, input.limit),
    ]);

    const documents = await tenantDb.invoice.findMany({
      where: {
        number: { contains: q.toUpperCase(), mode: "insensitive" },
        // RG-M01-09 — un document reste limité aux sites autorisés pour l'utilisateur.
        ...(ctx.allowedSiteIds === "ALL" ? {} : { siteId: { in: ctx.allowedSiteIds } }),
      },
      take: input.limit,
      select: { id: true, number: true, total: true, status: true, customerId: true },
    });

    return { customers, vehicles, documents };
  }),
});
