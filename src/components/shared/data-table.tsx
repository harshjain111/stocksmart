import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  numeric?: boolean;
  className?: string;
  /**
   * Where this column goes once the table collapses to cards under
   * 820px. Omitted means a labelled row in the card body, which is the
   * right default for most columns. The others exist because a card
   * reads badly when the thing that identifies the row ("PO-0007") is
   * buried in the middle of a label/value list:
   *
   *   title   — the card's heading, no label
   *   badge   — sits beside the heading (status tags, mostly)
   *   actions — pinned to a footer under a divider
   *   hidden  — dropped on mobile, for columns that only mean something
   *             next to their neighbours
   */
  cardRole?: "title" | "badge" | "actions" | "hidden";
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  skeletonRows?: number;
  emptyState?: React.ReactNode;
  /**
   * The table already sits inside a bordered panel with its own heading
   * (the Overview and Reports dashboards, the PO detail cards). Drops
   * this component's own border so the two don't nest, and renders the
   * mobile cards as tinted rows rather than cards-inside-a-card.
   */
  embedded?: boolean;
};

// Tables collapse to cards under 820px — HODs and store staff work off phones.
export function DataTable<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  isLoading = false,
  skeletonRows = 5,
  emptyState,
  embedded = false,
}: DataTableProps<T>) {
  if (!isLoading && data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const titleColumns = columns.filter((c) => c.cardRole === "title");
  const badgeColumns = columns.filter((c) => c.cardRole === "badge");
  const actionColumns = columns.filter((c) => c.cardRole === "actions");
  const bodyColumns = columns.filter((c) => c.cardRole === undefined);

  return (
    <>
      <div
        className={cn(
          "hidden overflow-x-auto min-[820px]:block",
          !embedded && "rounded-lg border",
        )}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(col.numeric && "text-right", col.className)}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: skeletonRows }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col.key}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data.map((row, i) => (
                  <TableRow
                    key={getRowKey(row, i)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? "cursor-pointer" : undefined}
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        className={cn(
                          col.numeric && "font-qty text-right",
                          col.className,
                        )}
                      >
                        {col.render(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      <div
        className={cn(
          "grid min-[820px]:hidden",
          embedded ? "gap-2 p-4 pt-0" : "gap-3",
        )}
      >
        {isLoading
          ? Array.from({ length: skeletonRows }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))
          : data.map((row, i) => (
              <Card
                key={getRowKey(row, i)}
                size={embedded ? "sm" : "default"}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  onRowClick && "cursor-pointer",
                  // Inside a panel these read as rows, not as cards of
                  // their own: tinted, tighter, and without the ring and
                  // shadow that would compete with the panel's border.
                  embedded && "bg-muted/40 rounded-lg shadow-none ring-0",
                )}
              >
                <CardContent className="grid gap-1.5">
                  {(titleColumns.length > 0 || badgeColumns.length > 0) && (
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid gap-0.5">
                        {titleColumns.map((col) => (
                          <div key={col.key} className="text-sm font-medium">
                            {col.render(row)}
                          </div>
                        ))}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {badgeColumns.map((col) => (
                          <div key={col.key}>{col.render(row)}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {bodyColumns.map((col) => (
                    <div
                      key={col.key}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {col.header}
                      </span>
                      <span
                        className={cn(
                          "text-right",
                          col.numeric && "font-qty",
                        )}
                      >
                        {col.render(row)}
                      </span>
                    </div>
                  ))}

                  {actionColumns.length > 0 && (
                    <div className="flex items-center justify-end gap-2 border-t pt-2">
                      {actionColumns.map((col) => (
                        <div key={col.key}>{col.render(row)}</div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
      </div>
    </>
  );
}
