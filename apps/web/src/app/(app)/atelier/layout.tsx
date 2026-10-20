import type { ReactNode } from "react";
import { WorkshopTabs } from "@/components/workshop/tabs";

export default function WorkshopLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <WorkshopTabs />
      {children}
    </div>
  );
}
