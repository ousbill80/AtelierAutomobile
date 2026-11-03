// Cloche de notifications (in-app) et abonnements push de la PWA. Les notifications sont
// personnelles (filtrées par `membershipId`) : l'appartenance à l'organisation suffit
// (orgProcedure), comme les alertes du tableau de bord.
import { db, pushNotificationToDevices } from "@atelieros/db";
import { pushProviderFromEnv } from "@atelieros/integrations";
import {
  notificationListInputSchema,
  notificationMarkReadInputSchema,
  pushSubscribeInputSchema,
  pushUnsubscribeInputSchema,
} from "@atelieros/validators";
import { orgProcedure, router } from "../trpc";

const pushProvider = pushProviderFromEnv();

export const notificationsRouter = router({
  list: orgProcedure.input(notificationListInputSchema).query(async ({ ctx, input }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const rows = await tenantDb.notification.findMany({
      where: {
        membershipId: ctx.membership.id,
        ...(input.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        link: true,
        severity: true,
        readAt: true,
        createdAt: true,
      },
    });
    const nextCursor = rows.length > input.limit ? rows[input.limit - 1]!.id : null;
    return { items: rows.slice(0, input.limit), nextCursor };
  }),

  unreadCount: orgProcedure.query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const count = await tenantDb.notification.count({
      where: { membershipId: ctx.membership.id, readAt: null },
    });
    return { count };
  }),

  markRead: orgProcedure.input(notificationMarkReadInputSchema).mutation(async ({ ctx, input }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const result = await tenantDb.notification.updateMany({
      where: { id: { in: input.ids }, membershipId: ctx.membership.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }),

  markAllRead: orgProcedure.mutation(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const result = await tenantDb.notification.updateMany({
      where: { membershipId: ctx.membership.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }),

  push: router({
    /** Clé publique VAPID ; `enabled = false` si le serveur n'a pas de clés (mode console). */
    config: orgProcedure.query(async ({ ctx }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const devices = await tenantDb.pushSubscription.count({
        where: { membershipId: ctx.membership.id },
      });
      return {
        enabled: pushProvider.publicKey !== null,
        publicKey: pushProvider.publicKey,
        devices,
      };
    }),

    subscribe: orgProcedure.input(pushSubscribeInputSchema).mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      // Un appareil (endpoint) reçoit les notifications d'un seul membre par garage : on le
      // rattache au membre connecté (changement de compte sur le même téléphone).
      await tenantDb.pushSubscription.deleteMany({ where: { endpoint: input.endpoint } });
      await tenantDb.pushSubscription.create({
        data: {
          organizationId: ctx.organizationId,
          membershipId: ctx.membership.id,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

    unsubscribe: orgProcedure.input(pushUnsubscribeInputSchema).mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const result = await tenantDb.pushSubscription.deleteMany({
        where: { endpoint: input.endpoint, membershipId: ctx.membership.id },
      });
      return { removed: result.count };
    }),

    /** Notification de test : apparaît dans la cloche et part tout de suite sur les appareils. */
    test: orgProcedure.mutation(async ({ ctx }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const notification = await tenantDb.notification.create({
        data: {
          organizationId: ctx.organizationId,
          membershipId: ctx.membership.id,
          type: "push.test",
          title: "Notifications activées",
          body: "Vous recevrez ici les alertes de relances, de créances et de l'atelier.",
          link: "/notifications",
          severity: "info",
        },
      });
      const report = await pushNotificationToDevices(tenantDb, notification, pushProvider, now);
      return { ...report, provider: pushProvider.name };
    }),
  }),
});
