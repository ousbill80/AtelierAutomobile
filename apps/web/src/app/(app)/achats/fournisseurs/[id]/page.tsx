import { SupplierView } from "./supplier-view";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierView id={id} />;
}
