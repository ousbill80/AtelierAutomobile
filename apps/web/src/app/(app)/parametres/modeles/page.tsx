"use client";

// RG-M11 §7.3 : éditeur de modèles avec aperçu et compteur SMS (version minimale).
import { useState } from "react";
import { Button, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/client";

export default function TemplatesPage() {
  const utils = trpc.useUtils();
  const { data: templates, isLoading } = trpc.template.list.useQuery({});
  const upsert = trpc.template.upsert.useMutation({
    onSuccess: () => utils.template.list.invalidate(),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [previewBody, setPreviewBody] = useState("");

  const selected = templates?.find((t) => t.id === selectedId) ?? null;
  const preview = trpc.template.preview.useQuery(
    { channel: selected?.channel ?? "SMS", body: previewBody, context: {} },
    { enabled: previewBody.trim().length > 0 },
  );

  function select(templateId: string) {
    const template = templates?.find((t) => t.id === templateId);
    setSelectedId(templateId);
    setBody(template?.body ?? "");
    setPreviewBody(template?.body ?? "");
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="flex w-full flex-col gap-2 md:w-72">
        <h1 className="text-xl font-semibold">Modèles</h1>
        {isLoading && <p className="text-sm text-muted">Chargement…</p>}
        {templates?.map((template) => (
          <button
            key={template.id}
            onClick={() => select(template.id)}
            className={`min-h-11 rounded-md border px-3 text-left text-sm ${selectedId === template.id ? "bg-accent text-accent-foreground" : ""}`}
          >
            {template.name} <span className="opacity-70">({template.channel})</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="flex flex-1 flex-col gap-3">
          <h2 className="font-semibold">{selected.name}</h2>
          <textarea
            className="min-h-32 rounded-md border p-3 text-sm"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setPreviewBody(e.target.value);
            }}
          />

          {preview.data?.sms && (
            <p className="text-sm text-muted">
              {preview.data.sms.chars} car. · {preview.data.sms.segments} SMS ·{" "}
              {preview.data.sms.encoding}
            </p>
          )}
          {preview.data?.warnings.map((warning: string, index: number) => (
            <StatusBadge key={index} tone="warn" label={warning} />
          ))}
          {preview.data?.rendered && (
            <div className="rounded-md bg-surface-2 p-3 text-sm">{preview.data.rendered}</div>
          )}

          <Button
            onClick={() =>
              upsert.mutate({
                id: selected.id,
                key: selected.key,
                name: selected.name,
                channel: selected.channel,
                subject: selected.subject,
                body,
                isActive: selected.isActive,
              })
            }
          >
            Enregistrer
          </Button>
        </div>
      )}
    </div>
  );
}
