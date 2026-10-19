import { QcView } from "./qc-view";

export default async function QcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QcView id={id} />;
}
