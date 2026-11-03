"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { guideNavLabel } from "./module-guide";

export function GuideLink({ href }: { href: string }) {
  return (
    <Link href={href} className="btn btn-secondary min-h-11">
      <BookOpen size={16} aria-hidden /> {guideNavLabel()}
    </Link>
  );
}
