// RG-M06-08/09/10 — productivité par mécanicien (présence, pointé, vendu, efficacité). Une
// seule implémentation pour l'écran atelier M06 et le rapport « Productivité » M12 (§7).
import {
  attributeBilledHours,
  businessDate,
  computeDurationMinutes,
  laborCost,
  presenceMinutes,
  productivityMetrics,
  type WorkedMinutes,
} from "@atelieros/core";
import type { Prisma, ScopedTenantClient } from "@atelieros/db";

export interface ProductivityParams {
  timeZone: string;
  from: Date;
  to: Date;
  siteId?: string;
  /** Filtre site des OR (déjà intersecté avec `Membership.siteIds`). */
  repairOrderWhere: Prisma.RepairOrderWhereInput;
  now: Date;
}

export async function loadProductivity(tx: ScopedTenantClient, p: ProductivityParams) {
  const [members, attendances, entries, invoiceLines] = await Promise.all([
    tx.membership.findMany({
      where: {
        OR: [
          { role: "MECHANIC", isActive: true },
          { timeEntries: { some: { startedAt: { gte: p.from, lt: p.to } } } },
        ],
      },
      include: { user: { select: { name: true } } },
    }),
    tx.attendance.findMany({
      where: {
        date: {
          gte: businessDate(p.from, p.timeZone),
          lte: businessDate(new Date(p.to.getTime() - 1), p.timeZone),
        },
        ...(p.siteId ? { siteId: p.siteId } : {}),
      },
    }),
    tx.timeEntry.findMany({
      where: { startedAt: { gte: p.from, lt: p.to }, repairOrder: p.repairOrderWhere },
    }),
    tx.invoiceLine.findMany({
      where: {
        type: "LABOR",
        repairOrderLineId: { not: null },
        invoice: {
          type: "INVOICE",
          status: { notIn: ["DRAFT", "VOID"] },
          issuedAt: { gte: p.from, lt: p.to },
          ...(p.siteId ? { siteId: p.siteId } : {}),
        },
      },
      select: { repairOrderLineId: true, quantity: true },
    }),
  ]);
  const soldByLine = new Map<string, number>();
  for (const l of invoiceLines) {
    soldByLine.set(l.repairOrderLineId!, (soldByLine.get(l.repairOrderLineId!) ?? 0) + l.quantity);
  }
  const billedLines = await tx.repairOrderLine.findMany({
    where: { id: { in: [...soldByLine.keys()] } },
    select: { id: true, assignedToId: true, payer: true },
  });
  const lineEntries = await tx.timeEntry.findMany({
    where: { repairOrderLineId: { in: [...soldByLine.keys()] } },
  });
  const attributed = attributeBilledHours(
    billedLines.map((l) => ({ ...l, quantity: soldByLine.get(l.id) ?? 0 })),
    lineEntries.map<WorkedMinutes>((e) => ({
      repairOrderLineId: e.repairOrderLineId,
      membershipId: e.membershipId,
      minutes: computeDurationMinutes(e, p.now),
      kind: e.kind,
    })),
  );
  return members
    .map((m) => {
      const own = entries.filter((e) => e.membershipId === m.id);
      const minutes = own.map((e) => computeDurationMinutes(e, p.now));
      const worked = minutes.reduce((s, x) => s + x, 0);
      const rework = own
        .filter((e) => e.kind === "REWORK")
        .reduce((s, e) => s + computeDurationMinutes(e, p.now), 0);
      const presence = attendances
        .filter((a) => a.membershipId === m.id)
        .reduce((s, a) => s + presenceMinutes(a, p.now), 0);
      const billed = attributed.get(m.id);
      return {
        membershipId: m.id,
        name: m.user.name,
        ...productivityMetrics({
          presenceMinutes: presence,
          workedMinutes: worked,
          reworkMinutes: rework,
          billedHours: billed?.billedHours ?? 0,
          laborCost: laborCost(minutes, m.hourlyCost),
        }),
        nonCustomerH: Math.round((billed?.nonCustomerHours ?? 0) * 100) / 100,
        repairOrders: new Set(own.map((e) => e.repairOrderId)).size,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
