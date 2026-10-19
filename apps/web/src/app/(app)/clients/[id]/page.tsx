import { CustomerView } from "./customer-view";

// Page authentifiée, propre à un client : jamais prérendue statiquement.
export const instant = false;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerView id={id} />;
}
