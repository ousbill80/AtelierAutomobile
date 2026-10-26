import type { ReactNode } from "react";

// Remonté à chaque navigation entre sections : la page entre en fondu (motion.css).
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
