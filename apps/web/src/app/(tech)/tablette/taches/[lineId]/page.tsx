import { TabletApp } from "@/components/tablet/app";

export default async function TabletTaskPage({ params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await params;
  return <TabletApp initialPath={`/tablette/taches/${lineId}`} />;
}
