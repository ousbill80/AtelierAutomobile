import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, fixedClock, systemClock } from "@atelieros/core";
import { adminDb, deleteTestOrganizations } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { recordStatusEvent } from "../messaging/inbound";
import { setReceivablesClock } from "../receivables/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);
const NOW = new Date("2026-11-02T09:00:00.000Z");

async function caller(organizationId: string, role: "OWNER" | "CASHIER", userIds: string[]) {
  const user = await adminDb.user.create({
    data: { name: `${role} MED`, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  userIds.push(user.id);
  await adminDb.membership.create({ data: { organizationId, userId: user.id, role, siteIds: [] } });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organizationId,
      isPinSession: false,
    },
  });
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return callerFactory(
    await createContext({ req, resHeaders: new Headers(), info: undefined as never }),
  );
}

describe("mise en demeure (M09 RG-M09-16) : envoi, remise, accusé de réception", () => {
  const userIds: string[] = [];
  let orgA: string;
  let orgB: string;
  let owner: Awaited<ReturnType<typeof caller>>;
  let cashier: Awaited<ReturnType<typeof caller>>;
  let ownerB: Awaited<ReturnType<typeof caller>>;
  let customerId: string;
  let caseId: string;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = "local";
    process.env.LOCAL_STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "atelieros-med-"));
    setReceivablesClock(fixedClock(NOW));
    orgA = (await adminDb.organization.create({ data: { name: "Garage MED A", city: "Abidjan" } }))
      .id;
    orgB = (await adminDb.organization.create({ data: { name: "Garage MED B" } })).id;
    owner = await caller(orgA, "OWNER", userIds);
    cashier = await caller(orgA, "CASHIER", userIds);
    ownerB = await caller(orgB, "OWNER", userIds);
    const site = await adminDb.site.create({
      data: { organizationId: orgA, name: "Plateau", code: "PLT" },
    });
    customerId = (
      await adminDb.customer.create({
        data: { organizationId: orgA, displayName: "SOTRA Logistique SARL", type: "COMPANY" },
      })
    ).id;
    caseId = (
      await adminDb.collectionCase.create({
        data: {
          organizationId: orgA,
          customerId,
          status: "ESCALATED",
          overdueDue: 640_000,
          totalDue: 640_000,
        },
      })
    ).id;
    await adminDb.invoice.create({
      data: {
        organizationId: orgA,
        siteId: site.id,
        customerId,
        number: "FAC-2026-000350",
        status: "OVERDUE",
        issuedAt: new Date("2026-08-16"),
        dueDate: new Date("2026-08-16"),
        total: 640_000,
        balance: 640_000,
        origin: "IMPORTED",
        collectionCaseId: caseId,
      },
    });
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgA,
        channel: "EMAIL",
        provider: "console",
        isActive: true,
        priority: 1,
        credentials: "",
      },
    });
  });

  afterAll(async () => {
    setReceivablesClock(systemClock);
    await deleteTestOrganizations([orgA, orgB], userIds);
  });

  it("réservé au gérant ; invisible depuis un autre garage", async () => {
    await expect(cashier.collections.formalNoticeSend({ caseId })).rejects.toThrow();
    await expect(
      cashier.collections.formalNoticeDelivered({
        caseId,
        deliveredOn: "2026-11-02",
        method: "hand",
      }),
    ).rejects.toThrow();
    await expect(ownerB.collections.formalNoticeSend({ caseId })).rejects.toThrow();
  });

  it("envoi par email : refus clair sans email, puis PDF joint et date de mise en demeure", async () => {
    await expect(owner.collections.formalNoticeSend({ caseId })).rejects.toThrow(/pas d'email/);
    await adminDb.customer.update({
      where: { id: customerId },
      data: { email: "compta@sotra.ci" },
    });

    const sent = await owner.collections.formalNoticeSend({ caseId });
    expect(sent.to).toBe("compta@sotra.ci");
    const message = await adminDb.message.findUniqueOrThrow({ where: { id: sent.messageId } });
    expect(message).toMatchObject({ channel: "EMAIL", to: "compta@sotra.ci" });
    expect(message.idempotencyKey).toMatch(new RegExp(`^fn:${caseId}:EMAIL:`));
    expect(JSON.stringify(message.attachments)).toContain("Mise-en-demeure-SOTRA-Logistique-SARL-");

    const view = await owner.collections.getCase({ id: caseId });
    expect(view.formalNotice.issuedAt).not.toBeNull();
    expect(view.formalNotice.deliveredAt).toBeNull();
    expect(view.formalNotice.sendings).toHaveLength(1);

    // Le fournisseur confirme la remise : accusé de réception enregistré automatiquement.
    await adminDb.message.update({
      where: { id: message.id },
      data: { status: "SENT", providerMessageId: `prov-${message.id}`, sentAt: NOW },
    });
    await recordStatusEvent({
      organizationId: orgA,
      providerMessageId: `prov-${message.id}`,
      status: "DELIVERED",
      occurredAt: new Date("2026-11-02T09:05:00.000Z"),
    });
    const after = await owner.collections.getCase({ id: caseId });
    expect(after.formalNotice.method).toBe("email");
    expect(new Date(after.formalNotice.deliveredAt!).toISOString()).toBe(
      "2026-11-02T09:05:00.000Z",
    );
    expect(after.formalNotice.sendings[0]!.state).toBe("delivered");
  });

  it("« Marquer comme remise » : contrôle des dates, puis remise en main propre consignée", async () => {
    await expect(
      owner.collections.formalNoticeDelivered({
        caseId,
        deliveredOn: "2026-11-05",
        method: "hand",
      }),
    ).rejects.toThrow(/futur/);
    await expect(
      owner.collections.formalNoticeDelivered({
        caseId,
        deliveredOn: "2026-10-01",
        method: "hand",
      }),
    ).rejects.toThrow(/précéder/);

    await owner.collections.formalNoticeDelivered({
      caseId,
      deliveredOn: "2026-11-02",
      method: "bailiff",
      note: "Signée par le comptable",
    });
    const kase = await adminDb.collectionCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(kase.formalNoticeMethod).toBe("bailiff");
    expect(kase.formalNoticeDeliveredAt?.toISOString().slice(0, 10)).toBe("2026-11-02");
    const note = await adminDb.collectionNote.findFirst({
      where: { collectionCaseId: caseId, body: { contains: "par huissier" } },
    });
    expect(note?.body).toContain("Signée par le comptable");
    const audit = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA, action: "receivable.formal_notice_delivered" },
    });
    expect(audit).not.toBeNull();
  });
});
