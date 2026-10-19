import { CountView } from "./count-view";

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CountView id={id} />;
}
