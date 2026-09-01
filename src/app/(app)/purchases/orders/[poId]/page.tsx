import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getPoDetail } from "@/app/(app)/purchases/orders/[poId]/actions";
import { PoDetailView } from "@/components/purchases/po-detail-view";

export default async function PoDetailPage({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  const { poId } = await params;
  const session = await getSession();
  if (!session || !can(session.role, "nav:purchases")) {
    redirect("/");
  }

  const result = await getPoDetail(poId);
  if (!result.success) notFound();

  return (
    <PoDetailView
      initialDetail={result.data}
      canEdit={can(session.role, "purchase:manage")}
    />
  );
}
