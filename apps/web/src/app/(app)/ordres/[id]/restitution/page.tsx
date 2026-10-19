import { DeliveryView } from "./delivery-view";

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeliveryView id={id} />;
}
