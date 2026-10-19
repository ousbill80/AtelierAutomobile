import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { computeInvitationExpiry, hashInvitationToken } from "../invitation-token";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function anonymousContext() {
  const req = new Request("http://localhost/api/trpc");
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

describe("invitation router (M01)", () => {
  let org: { id: string };
  let inviterUser: { id: string };
  let inviterMembership: { id: string };
  const userIds: string[] = [];

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Invitation Test" } });
    inviterUser = await adminDb.user.create({
      data: {
        name: "Gérant Invitation Test",
        email: `inv-${randomBytes(4).toString("hex")}@example.com`,
      },
    });
    inviterMembership = await adminDb.membership.create({
      data: { organizationId: org.id, userId: inviterUser.id, role: "OWNER", siteIds: [] },
    });
    userIds.push(inviterUser.id);
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: org.id } });
    await adminDb.invitation.deleteMany({ where: { organizationId: org.id } });
    await adminDb.membership.deleteMany({ where: { organizationId: org.id } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  async function createInvitation(
    overrides: Partial<{ email: string; phone: string; role: string }>,
  ) {
    const token = randomBytes(32).toString("base64url");
    const invitation = await adminDb.invitation.create({
      data: {
        organizationId: org.id,
        name: "Invité Test",
        email: overrides.email,
        phone: overrides.phone,
        role: (overrides.role ?? "CASHIER") as never,
        siteIds: [],
        permissions: [],
        tokenHash: hashInvitationToken(token),
        channel: "EMAIL",
        status: "PENDING",
        invitedById: inviterMembership.id,
        expiresAt: computeInvitationExpiry(new Date()),
      },
    });
    return { token, invitation };
  }

  it("invitation.preview retourne les infos pour un token valide", async () => {
    const { token } = await createInvitation({
      email: `preview-${randomBytes(4).toString("hex")}@example.com`,
    });
    const caller = callerFactory(await anonymousContext());
    const result = await caller.invitation.preview({ token });
    expect(result.organizationName).toBe("Garage Invitation Test");
    expect(result.role).toBe("CASHIER");
    expect(result.inviterName).toBe("Gérant Invitation Test");
  });

  it("invitation.preview refuse un token inconnu", async () => {
    const caller = callerFactory(await anonymousContext());
    await expect(caller.invitation.preview({ token: "token-invalide" })).rejects.toThrow(
      "n'est plus valable",
    );
  });

  it("invitation.preview refuse un token expiré", async () => {
    const token = randomBytes(32).toString("base64url");
    await adminDb.invitation.create({
      data: {
        organizationId: org.id,
        name: "Invité Expiré",
        email: `expired-${randomBytes(4).toString("hex")}@example.com`,
        role: "CASHIER",
        siteIds: [],
        permissions: [],
        tokenHash: hashInvitationToken(token),
        channel: "EMAIL",
        status: "PENDING",
        invitedById: inviterMembership.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const caller = callerFactory(await anonymousContext());
    await expect(caller.invitation.preview({ token })).rejects.toThrow("n'est plus valable");
  });

  it("invitation.accept exige un mot de passe pour un nouvel utilisateur", async () => {
    const { token } = await createInvitation({
      email: `accept-${randomBytes(4).toString("hex")}@example.com`,
    });
    const caller = callerFactory(await anonymousContext());
    await expect(caller.invitation.accept({ token })).rejects.toThrow("Un mot de passe est requis");
  });

  it("invitation.accept crée un utilisateur, une adhésion et journalise member.joined", async () => {
    const email = `accept-${randomBytes(4).toString("hex")}@example.com`;
    const { token, invitation } = await createInvitation({ email });
    const caller = callerFactory(await anonymousContext());
    const result = await caller.invitation.accept({ token, password: "MotDePasse123!" });
    expect(result.ok).toBe(true);

    const updatedInvitation = await adminDb.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(updatedInvitation.status).toBe("ACCEPTED");
    userIds.push(updatedInvitation.acceptedUserId!);

    const membership = await adminDb.membership.findFirst({
      where: { organizationId: org.id, userId: updatedInvitation.acceptedUserId! },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe("CASHIER");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: org.id, action: "member.joined", entityId: membership!.id },
    });
    expect(log).not.toBeNull();
  });

  it("invitation.accept réutilise un utilisateur existant sans exiger de mot de passe", async () => {
    const email = `existing-${randomBytes(4).toString("hex")}@example.com`;
    const existingUser = await adminDb.user.create({ data: { name: "Déjà Inscrit", email } });
    userIds.push(existingUser.id);

    const { token } = await createInvitation({ email, role: "STOREKEEPER" });
    const caller = callerFactory(await anonymousContext());
    const result = await caller.invitation.accept({ token });
    expect(result.ok).toBe(true);

    const membership = await adminDb.membership.findFirst({
      where: { organizationId: org.id, userId: existingUser.id },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe("STOREKEEPER");
  });
});
