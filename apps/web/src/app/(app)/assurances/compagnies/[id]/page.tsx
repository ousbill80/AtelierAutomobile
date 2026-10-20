import { InsurerView } from "./insurer-view";

export default async function InsurerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InsurerView id={id} />;
}
