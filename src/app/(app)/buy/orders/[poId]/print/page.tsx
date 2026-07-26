import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatGrams } from "@/lib/units";
import { PrintButton } from "@/components/send-receive/print-button";

export default async function PoPrintPage({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  const { poId } = await params;
  const session = await getSession();
  if (!session || !can(session.role, "nav:buy")) {
    redirect("/");
  }

  const admin = createAdminClient();
  const { data: po } = await admin
    .from("purchase_orders")
    .select(
      "id, po_no, status, branch_id, created_at, sent_at, notes, suppliers(name, area, contact_person, phone, gstin), departments(name, branches(name))",
    )
    .eq("id", poId)
    .single();
  if (!po) notFound();
  if (session.role !== "admin" && po.branch_id !== session.branchId) {
    redirect("/");
  }

  const { data: lines } = await admin
    .from("po_lines")
    .select("qty_g, rate, raw_materials(name, code)")
    .eq("purchase_order_id", poId)
    .order("created_at", { ascending: true });

  const supplier = po.suppliers as unknown as {
    name: string;
    area: string | null;
    contact_person: string | null;
    phone: string | null;
    gstin: string | null;
  } | null;
  const shipTo = po.departments as unknown as {
    name: string;
    branches: { name: string } | null;
  } | null;

  return (
    <div className="mx-auto max-w-2xl p-8 print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <h1 className="text-lg font-semibold">Purchase order</h1>
        <PrintButton />
      </div>

      <div className="grid gap-6 rounded-lg border p-8 print:border-none">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xl font-semibold">Smooxy Inventory</p>
            <p className="text-muted-foreground text-sm">
              {shipTo?.branches?.name}
            </p>
          </div>
          <div className="text-right">
            <p className="font-medium">{po.po_no}</p>
            <p className="text-muted-foreground text-sm">
              {new Date(po.created_at).toLocaleDateString("en-IN", {
                dateStyle: "medium",
              })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 border-t border-b py-4 text-sm">
          <div>
            <p className="text-muted-foreground">Supplier</p>
            <p className="font-medium">{supplier?.name ?? "Unknown"}</p>
            {supplier?.area && <p>{supplier.area}</p>}
            {supplier?.contact_person && <p>{supplier.contact_person}</p>}
            {supplier?.phone && <p>{supplier.phone}</p>}
            {supplier?.gstin && (
              <p className="text-muted-foreground">GSTIN {supplier.gstin}</p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground">Ship to</p>
            <p className="font-medium">{shipTo?.name}</p>
            <p>{shipTo?.branches?.name}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Material</th>
              <th className="py-2 text-right font-medium">Quantity</th>
              <th className="py-2 text-right font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((line, i) => {
              const material = line.raw_materials as unknown as {
                name: string;
                code: string | null;
              } | null;
              return (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2">
                    {material?.name ?? "Unknown material"}
                    {material?.code && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {material.code}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {formatGrams(line.qty_g)}
                  </td>
                  <td className="py-2 text-right">
                    {line.rate != null ? `₹${line.rate}` : "To be confirmed"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {po.notes && (
          <div className="text-sm">
            <p className="text-muted-foreground">Notes</p>
            <p>{po.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
