import { RepairOrderView } from "./repair-order-view";

export default async function RepairOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RepairOrderView id={id} />;
}
