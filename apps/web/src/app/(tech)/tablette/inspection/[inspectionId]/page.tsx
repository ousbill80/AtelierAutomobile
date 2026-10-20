import { TabletApp } from "@/components/tablet/app";

export default async function TabletInspectionPage({
  params,
}: {
  params: Promise<{ inspectionId: string }>;
}) {
  const { inspectionId } = await params;
  return <TabletApp initialPath={`/tablette/inspection/${inspectionId}`} />;
}
