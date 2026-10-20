// M14 §8 — procédures publiques du portail ajoutées à l'étape 6.3 : renvoi d'un nouveau lien,
// véhicule (historique et échéances), avis, accès « Mon espace » par OTP et vue multi-documents.
// Aucune ne prend d'`organizationId` en entrée : le jeton ou la session portail le fournit.
import {
  portalAccountOpenInputSchema,
  portalFeedbackInputSchema,
  portalOtpRequestInputSchema,
  portalOtpVerifyInputSchema,
  portalTokenOnlyInputSchema,
} from "@atelieros/validators";
import { z } from "zod";
import { portalNow, requirePortalToken } from "../portal/access";
import {
  accountOverview,
  logoutPortalSession,
  openAccountDocument,
  requestPortalOtp,
  requirePortalSession,
  verifyPortalOtp,
} from "../portal/account";
import { buildFeedbackView, submitFeedback } from "../portal/feedback";
import { requestNewLink } from "../portal/links";
import { buildVehicleView, openVehicleDocument } from "../portal/vehicle";
import { publicProcedure, router } from "../trpc";

export const portalVehicleRouter = router({
  /** US-M14-07 — échéances (VT, révision, assurance) et passages du véhicule. */
  get: publicProcedure.input(portalTokenOnlyInputSchema).query(async ({ ctx, input }) => {
    const now = portalNow();
    const token = await requirePortalToken(input.token, ["VEHICLE"], ctx, { now });
    return buildVehicleView(token, now);
  }),

  openDocument: publicProcedure
    .input(
      portalTokenOnlyInputSchema.extend({
        kind: z.enum(["invoice", "repair_order"]),
        index: z.number().int().min(0).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = portalNow();
      const parent = await requirePortalToken(input.token, ["VEHICLE"], ctx, {
        now,
        count: false,
        action: "document_open",
      });
      return openVehicleDocument({
        parentToken: input.token,
        parent,
        kind: input.kind,
        index: input.index,
        now,
      });
    }),
});

export const portalFeedbackRouter = router({
  get: publicProcedure.input(portalTokenOnlyInputSchema).query(async ({ ctx, input }) => {
    const token = await requirePortalToken(input.token, ["SURVEY"], ctx, { now: portalNow() });
    return buildFeedbackView(token);
  }),

  /** US-M14-11 — note 1-5 + commentaire ; un seul avis par OR (rejeu → avis existant). */
  submit: publicProcedure.input(portalFeedbackInputSchema).mutation(async ({ ctx, input }) => {
    const now = portalNow();
    const token = await requirePortalToken(input.token, ["SURVEY"], ctx, {
      now,
      count: false,
      action: "feedback",
    });
    return submitFeedback(token, { rating: input.rating, comment: input.comment }, now);
  }),
});

export const portalAuthRouter = router({
  /** US-M14-08 — réponse identique que le numéro soit connu ou non. */
  requestOtp: publicProcedure
    .input(portalOtpRequestInputSchema)
    .mutation(({ ctx, input }) => requestPortalOtp(input, ctx, portalNow())),

  verifyOtp: publicProcedure
    .input(portalOtpVerifyInputSchema)
    .mutation(({ ctx, input }) => verifyPortalOtp(input, ctx, portalNow())),

  logout: publicProcedure.mutation(({ ctx }) =>
    logoutPortalSession(ctx.portalSessionToken, ctx.resHeaders, portalNow()),
  ),
});

export const portalAccountRouter = router({
  overview: publicProcedure.query(async ({ ctx }) => {
    const now = portalNow();
    const session = await requirePortalSession(ctx.portalSessionToken, now);
    return accountOverview(ctx.portalSessionToken!, session, now);
  }),

  open: publicProcedure.input(portalAccountOpenInputSchema).mutation(async ({ ctx, input }) => {
    const now = portalNow();
    const session = await requirePortalSession(ctx.portalSessionToken, now);
    return openAccountDocument(ctx.portalSessionToken!, session, input, ctx, now);
  }),
});

/** RG-M14-03 — « Recevoir un nouveau lien » (au numéro enregistré, 3 demandes/jour). */
export const portalRequestNewLink = publicProcedure
  .input(portalTokenOnlyInputSchema)
  .mutation(({ ctx, input }) => requestNewLink(input.token, ctx, portalNow()));
