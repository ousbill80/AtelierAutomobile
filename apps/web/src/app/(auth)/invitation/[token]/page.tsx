import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/trpc/server";
import { t } from "@/i18n/t";
import { InvitationAcceptForm } from "./InvitationAcceptForm";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const caller = await serverCaller();

  let invitation: Awaited<ReturnType<typeof caller.invitation.preview>> | null = null;
  let errorMessage: string | null = null;
  try {
    invitation = await caller.invitation.preview({ token });
  } catch (err) {
    errorMessage = err instanceof TRPCError ? err.message : t("auth.invitation.expired");
  }

  if (!invitation) {
    return <p className="error">{errorMessage}</p>;
  }

  return (
    <>
      <h1>{t("auth.invitation.title", { organizationName: invitation.organizationName })}</h1>
      <p>
        {t("auth.invitation.invitedBy", {
          inviterName: invitation.inviterName ?? "",
          role: invitation.role,
        })}
      </p>
      <InvitationAcceptForm token={token} />
    </>
  );
}
