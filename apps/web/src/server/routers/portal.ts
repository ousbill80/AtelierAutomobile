import {
  loadPortalBookingContext,
  portalBook,
  portalCancel,
  portalConfirm,
  portalReschedule,
  portalSlots,
  portalView,
} from "@atelieros/planning";
import {
  portalAppointmentCancelInputSchema,
  portalAppointmentConfirmInputSchema,
  portalAppointmentGetInputSchema,
  portalAppointmentRescheduleInputSchema,
  portalBookInputSchema,
  portalSlotsInputSchema,
} from "@atelieros/validators";
import { toTRPCError } from "../domain-error";
import { publicProcedure, router } from "../trpc";

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return toTRPCError(error);
  }
}

/**
 * Portail public `/p/[token]/rdv` (M03 §8, M14) : procédures authentifiées par jeton à portée
 * limitée (BOOKING : réserver ; APPOINTMENT : consulter, confirmer, déplacer, annuler).
 * Aucune session ni organisation active : tout passe par le jeton.
 */
export const portalRouter = router({
  appointment: router({
    get: publicProcedure
      .input(portalAppointmentGetInputSchema)
      .query(async ({ input }) =>
        run(async () => portalView(await loadPortalBookingContext(input.token))),
      ),

    slots: publicProcedure.input(portalSlotsInputSchema).query(async ({ input }) =>
      run(async () => {
        const context = await loadPortalBookingContext(input.token);
        return portalSlots(context, input.type);
      }),
    ),

    book: publicProcedure.input(portalBookInputSchema).mutation(async ({ ctx, input }) =>
      run(async () => {
        const context = await loadPortalBookingContext(input.token);
        const result = await portalBook(context, { ...input, ip: ctx.ip });
        return {
          id: result.appointment.id,
          startsAt: result.appointment.startsAt,
          endsAt: result.appointment.endsAt,
          status: result.appointment.status,
          type: result.appointment.type,
        };
      }),
    ),

    confirm: publicProcedure
      .input(portalAppointmentConfirmInputSchema)
      .mutation(async ({ input }) =>
        run(async () => {
          const context = await loadPortalBookingContext(input.token);
          const appointment = await portalConfirm(context);
          return {
            id: appointment.id,
            status: appointment.status,
            confirmedAt: appointment.confirmedAt,
          };
        }),
      ),

    cancel: publicProcedure.input(portalAppointmentCancelInputSchema).mutation(async ({ input }) =>
      run(async () => {
        const context = await loadPortalBookingContext(input.token);
        const appointment = await portalCancel(context);
        return { id: appointment.id, status: appointment.status };
      }),
    ),

    reschedule: publicProcedure
      .input(portalAppointmentRescheduleInputSchema)
      .mutation(async ({ ctx, input }) =>
        run(async () => {
          const context = await loadPortalBookingContext(input.token);
          const appointment = await portalReschedule(context, {
            startsAt: input.startsAt,
            ip: ctx.ip,
          });
          return {
            id: appointment.id,
            status: appointment.status,
            startsAt: appointment.startsAt,
            endsAt: appointment.endsAt,
          };
        }),
      ),
  }),
});
