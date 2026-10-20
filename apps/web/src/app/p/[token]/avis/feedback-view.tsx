"use client";

// M14 US-M14-11 — avis après restitution : 5 étoiles (boutons radio accessibles), commentaire
// facultatif (≤ 1 000 caractères), proposition d'avis Google si note ≥ 4 et lien configuré.
import { useState } from "react";
import { trpc } from "@/trpc/react";
import { tpl } from "../../_components/format";
import type { PortalLabels } from "../../_components/labels";
import { linkProblemOf, PortalLinkState } from "../../_components/link-state";
import { PortalFrame, PortalSkeleton } from "../../_components/portal-frame";

export function FeedbackView({ token, labels }: { token: string; labels: PortalLabels }) {
  const L = labels.feedback;
  const query = trpc.portal.feedback.get.useQuery(
    { token },
    { retry: false, refetchOnWindowFocus: false },
  );
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [result, setResult] = useState<{ googleReviewUrl: string | null } | null>(null);
  const submit = trpc.portal.feedback.submit.useMutation({ onSuccess: (r) => setResult(r) });

  if (query.isLoading) return <PortalSkeleton label={labels.loading} />;
  if (query.isError || !query.data) {
    return (
      <PortalFrame labels={labels}>
        <PortalLinkState
          problem={linkProblemOf(query.error)}
          token={token}
          labels={labels}
          onRetry={() => query.refetch()}
        />
      </PortalFrame>
    );
  }
  const d = query.data;
  const googleUrl = result?.googleReviewUrl ?? d.googleReviewUrl;
  const done = result !== null || d.submitted !== null;

  return (
    <PortalFrame garage={d.garage} labels={labels}>
      <h1 className="text-xl font-semibold">{L.title}</h1>
      <p>
        {tpl(L.intro, { number: d.number })} — {d.vehicle.make} {d.vehicle.model} ·{" "}
        {d.vehicle.plate}
      </p>
      {done ? (
        <section role="status" className="flex flex-col gap-3 rounded-lg bg-status-ok-bg p-4">
          <p className="font-semibold text-status-ok">
            ✓ {result || !d.submitted ? L.thanks : tpl(L.already, { rating: d.submitted.rating })}
          </p>
          {googleUrl && (
            <a
              href={googleUrl}
              className="btn btn-primary min-h-12"
              rel="noreferrer noopener"
              target="_blank"
            >
              ★ {L.google}
            </a>
          )}
        </section>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (rating < 1) return;
            submit.mutate({ token, rating, comment: comment.trim() || undefined });
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium">{L.stars}</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <label
                  key={n}
                  className={`flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-md text-3xl ${n <= rating ? "text-status-warn" : "text-muted"}`}
                >
                  <input
                    type="radio"
                    name="rating"
                    value={n}
                    checked={rating === n}
                    onChange={() => setRating(n)}
                    className="sr-only"
                    aria-label={tpl(L.star, { count: n })}
                  />
                  <span aria-hidden>{n <= rating ? "★" : "☆"}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{L.comment}</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              rows={4}
              className="rounded-md border border-border bg-surface p-2 text-base"
            />
            <span className="text-sm text-muted">{L.commentHint}</span>
          </label>
          {rating < 1 && submit.isIdle && <p className="text-sm text-muted">{L.chooseRating}</p>}
          {submit.error && (
            <p role="alert" className="text-status-bad">
              {submit.error.message}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary min-h-12"
            disabled={rating < 1 || submit.isPending}
          >
            {submit.isPending ? L.sending : L.submit}
          </button>
        </form>
      )}
    </PortalFrame>
  );
}
