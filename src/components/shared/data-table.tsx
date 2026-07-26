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
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  skeletonRows?: number;
  emptyState?: React.ReactNode;
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
}: DataTableProps<T>) {
  if (!isLoading && data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border min-[820px]:block">
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

      <div className="grid gap-3 min-[820px]:hidden">
        {isLoading
          ? Array.from({ length: skeletonRows }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))
          : data.map((row, i) => (
              <Card
                key={getRowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && "cursor-pointer")}
              >
                <CardContent className="grid gap-1.5">
                  {columns.map((col) => (
                    <div
                      key={col.key}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {col.header}
                      </span>
                      <span className={cn(col.numeric && "font-qty")}>
                        {col.render(row)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
      </div>
    </>
  );
}
