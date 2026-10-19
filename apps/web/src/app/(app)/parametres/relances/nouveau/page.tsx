"use client";

import { RuleForm } from "../rule-form";

export default function NewReminderRulePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Nouvelle règle de relance</h1>
      <RuleForm />
    </div>
  );
}
