import { InvoiceView } from "./invoice-view";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceView id={id} />;
}
