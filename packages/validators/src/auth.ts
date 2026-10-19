import { z } from "zod";

export const otpPurposeSchema = z.enum(["VERIFY", "RESET", "NEW_DEVICE", "LOGIN"]);
export type OtpPurpose = z.infer<typeof otpPurposeSchema>;

export const messageChannelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL"]);

export const signUpInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    password: z.string().min(8).max(100),
    acceptTerms: z.literal(true),
  })
  .refine((data) => Boolean(data.phone) || Boolean(data.email), {
    message: "Un numéro de téléphone ou un email est requis.",
    path: ["phone"],
  });
export type SignUpInput = z.infer<typeof signUpInputSchema>;

export const sendOtpInputSchema = z.object({
  identifier: z.string().trim().min(1),
  purpose: otpPurposeSchema,
  channel: messageChannelSchema.optional(),
});
export type SendOtpInput = z.infer<typeof sendOtpInputSchema>;

export const verifyOtpInputSchema = z.object({
  identifier: z.string().trim().min(1),
  code: z.string().trim().length(6),
  purpose: otpPurposeSchema,
});
export type VerifyOtpInput = z.infer<typeof verifyOtpInputSchema>;

export const signInInputSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
  deviceId: z.string().trim().min(1),
  otpCode: z.string().trim().length(6).optional(),
});
export type SignInInput = z.infer<typeof signInInputSchema>;

export const resetPasswordInputSchema = z.object({
  resetToken: z.string().trim().min(1),
  newPassword: z.string().min(8).max(100),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

export const pinSignInInputSchema = z.object({
  deviceId: z.string().trim().min(1),
  membershipId: z.string().trim().min(1),
  pin: z.string().trim().length(4),
});
export type PinSignInInput = z.infer<typeof pinSignInInputSchema>;
