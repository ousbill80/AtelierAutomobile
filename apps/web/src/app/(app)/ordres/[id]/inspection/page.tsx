import { InspectionView } from "./inspection-view";

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InspectionView repairOrderId={id} />;
}
