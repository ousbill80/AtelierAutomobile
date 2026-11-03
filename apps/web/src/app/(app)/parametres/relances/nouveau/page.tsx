"use client";

import { RuleForm } from "../rule-form";
import { t } from "@/i18n/t";

export default function NewReminderRulePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("reminders.rules.newTitle")}</h1>
      <RuleForm />
    </div>
  );
}
