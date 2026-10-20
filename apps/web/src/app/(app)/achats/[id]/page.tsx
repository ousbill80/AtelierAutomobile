import { PurchaseView } from "./purchase-view";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseView id={id} />;
}
