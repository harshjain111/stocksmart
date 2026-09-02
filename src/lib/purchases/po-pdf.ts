// Purchase order PDF generation.
//
// Supplier confidentiality (CLAUDE.md rule 8's sibling requirement for
// purchasing): this builder never decides on its own whether a supplier
// belongs in the document. The caller passes `supplier: null` and the
// supplier block simply doesn't exist in the output — there is no
// "hidden" or blanked-out field to recover. Server code is what decides
// whether a supplier is ever sent to the client in the first place; this
// is the last line of that same defence, not the first.
//
// jsPDF is imported dynamically by callers so it stays out of the shared
// client bundle — it's ~350KB and only ever needed on an explicit click.

export type PoPdfLine = {
  itemName: string;
  itemCode: string | null;
  qtyG: number;
  rate: number | null;
};

export type PoPdfPayload = {
  poNo: string;
  createdAt: string;
  sentAt: string | null;
  expectedDeliveryDate: string | null;
  branchName: string;
  shipTo: { departmentName: string; branchName: string };
  /** null renders no supplier block at all — see the note above. */
  supplier: {
    name: string;
    area: string | null;
    contactPerson: string | null;
    phone: string | null;
    gstin: string | null;
  } | null;
  lines: PoPdfLine[];
  notes: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });
}

function fmtQty(grams: number): string {
  if (Math.abs(grams) < 1000) return `${grams} g`;
  return `${Math.round((grams / 1000) * 1000) / 1000} kg`;
}

function fmtMoney(value: number): string {
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Builds the PO document and triggers a download. Returns the filename so
 * callers can surface it; throws on failure so the caller can show a real
 * error rather than a silently missing file.
 */
export async function downloadPoPdf(payload: PoPdfPayload): Promise<string> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const right = pageWidth - margin;
  let y = margin;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("SMOKZY", margin, y);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("PURCHASE ORDER", margin, y + 16);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(payload.poNo, right, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Raised ${fmtDate(payload.createdAt)}`, right, y + 14, {
    align: "right",
  });
  if (payload.sentAt) {
    doc.text(`Ordered ${fmtDate(payload.sentAt)}`, right, y + 26, {
      align: "right",
    });
  }

  y += 44;
  doc.setDrawColor(210);
  doc.line(margin, y, right, y);
  y += 20;

  // Parties. The supplier column only exists when one was supplied.
  const colWidth = (right - margin) / 2;
  const leftX = margin;
  const rightX = margin + colWidth;
  let leftY = y;
  let rightY = y;

  doc.setFontSize(8);
  doc.setTextColor(120);

  if (payload.supplier) {
    doc.text("SUPPLIER", leftX, leftY);
    leftY += 13;
    doc.setTextColor(20);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(payload.supplier.name, leftX, leftY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const detail of [
      payload.supplier.area,
      payload.supplier.contactPerson,
      payload.supplier.phone,
      payload.supplier.gstin ? `GSTIN ${payload.supplier.gstin}` : null,
    ]) {
      if (!detail) continue;
      leftY += 12;
      doc.text(detail, leftX, leftY);
    }
    doc.setTextColor(120);
    doc.setFontSize(8);
  }

  doc.text("SHIP TO", rightX, rightY);
  rightY += 13;
  doc.setTextColor(20);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(payload.shipTo.departmentName, rightX, rightY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  rightY += 12;
  doc.text(payload.shipTo.branchName, rightX, rightY);
  if (payload.expectedDeliveryDate) {
    rightY += 12;
    doc.text(
      `Expected ${fmtDate(payload.expectedDeliveryDate)}`,
      rightX,
      rightY,
    );
  }

  y = Math.max(leftY, rightY) + 24;

  // Line items
  const colQty = right - 200;
  const colRate = right - 110;
  const colAmount = right;

  doc.setDrawColor(210);
  doc.line(margin, y, right, y);
  y += 14;
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("ITEM", margin, y);
  doc.text("QUANTITY", colQty, y, { align: "right" });
  doc.text("RATE / kg", colRate, y, { align: "right" });
  doc.text("AMOUNT", colAmount, y, { align: "right" });
  y += 8;
  doc.line(margin, y, right, y);
  y += 16;

  doc.setTextColor(20);
  doc.setFontSize(9);

  let subtotal = 0;
  let anyRateMissing = false;

  for (const line of payload.lines) {
    if (y > pageHeight - margin - 90) {
      doc.addPage();
      y = margin;
    }
    const label = line.itemCode
      ? `${line.itemName}  (${line.itemCode})`
      : line.itemName;
    doc.text(label, margin, y, { maxWidth: colQty - margin - 12 });
    doc.text(fmtQty(line.qtyG), colQty, y, { align: "right" });

    if (line.rate == null) {
      anyRateMissing = true;
      doc.setTextColor(140);
      doc.text("to confirm", colRate, y, { align: "right" });
      doc.text("—", colAmount, y, { align: "right" });
      doc.setTextColor(20);
    } else {
      const amount = (line.qtyG / 1000) * line.rate;
      subtotal += amount;
      doc.text(fmtMoney(line.rate), colRate, y, { align: "right" });
      doc.text(fmtMoney(amount), colAmount, y, { align: "right" });
    }
    y += 18;
  }

  doc.setDrawColor(210);
  doc.line(margin, y, right, y);
  y += 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Total", colRate, y, { align: "right" });
  doc.text(`INR ${fmtMoney(subtotal)}`, colAmount, y, { align: "right" });
  doc.setFont("helvetica", "normal");

  if (anyRateMissing) {
    y += 14;
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(
      "Total excludes lines whose rate is still to be confirmed.",
      colAmount,
      y,
      { align: "right" },
    );
    doc.setTextColor(20);
  }

  if (payload.notes) {
    y += 28;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text("NOTES", margin, y);
    y += 13;
    doc.setTextColor(20);
    doc.setFontSize(9);
    doc.text(payload.notes, margin, y, { maxWidth: right - margin });
  }

  const filename = `${payload.poNo}.pdf`;
  doc.save(filename);
  return filename;
}
