import { isDomainError, normalizePhoneCI } from "@atelieros/core";
import { TRPCError } from "@trpc/server";

/** Normalise un téléphone saisi en E.164 (`core/phone`) ou lève une erreur lisible (RG-M02-04). */
export function normalizePhoneOrThrow(input: string): string {
  try {
    const result = normalizePhoneCI(input);
    if (result.status !== "OK" || !result.e164) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Numéro « ${input} » à vérifier (ancien format non résolu).`,
      });
    }
    return result.e164;
  } catch (error) {
    if (isDomainError(error)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}
