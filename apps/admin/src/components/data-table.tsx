'use client';

import { useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type SortingState,
} from '@tanstack/react-table';
import { Button, Table, Td, Th } from '@biznexa/ui';

/**
 * Admin list table: TanStack Table (headless) rendered with the shared `Table`/`Th`/`Td`.
 * Sorting by clicking a header, filtering via `globalFilter` (search box) and `columnFilters`
 * (selects owned by the page), and pages of `pageSize` rows. Filters live in the page so its
 * toolbar can show them.
 */
export function DataTable<T>({
  data,
  columns,
  caption,
  globalFilter = '',
  globalFilterFn,
  columnFilters = [],
  initialSorting = [],
  pageSize = 25,
  minWidth,
  empty,
  getRowId,
}: Readonly<{
  data: T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack's own ColumnDef[] typing for mixed value types
  columns: ColumnDef<T, any>[];
  caption: string;
  globalFilter?: string;
  globalFilterFn?: FilterFn<T>;
  columnFilters?: ColumnFiltersState;
  initialSorting?: SortingState;
  pageSize?: number;
  minWidth?: number;
  empty: ReactNode;
  getRowId: (row: T) => string;
}>) {
  // useReactTable returns a mutable instance whose methods change without a new identity;
  // React Compiler memoization would show stale rows, so this component opts out.
  'use no memo';
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });

  // A new search or filter starts from the first page; editing a row (new `data`) keeps the page.
  const filterKey = JSON.stringify([globalFilter, columnFilters]);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }

  // eslint-disable-next-line react-hooks/incompatible-library -- known; handled by 'use no memo' above
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnFilters, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    globalFilterFn: globalFilterFn ?? 'includesString',
    autoResetPageIndex: false,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;
  const first = total === 0 ? 0 : pageIndex * pagination.pageSize + 1;
  const last = Math.min(total, (pageIndex + 1) * pagination.pageSize);

  return (
    <div>
      <Table caption={caption} minWidth={minWidth}>
        <thead className="border-b border-rule">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                const label = flexRender(h.column.columnDef.header, h.getContext());
                let sortIcon = '';
                if (sorted === 'asc') sortIcon = '↑';
                else if (sorted === 'desc') sortIcon = '↓';
                let sort: 'ascending' | 'descending' | undefined;
                if (sorted === 'asc') sort = 'ascending';
                else if (sorted === 'desc') sort = 'descending';
                return (
                  <Th key={h.id} aria-sort={sort} className={h.column.columnDef.meta?.className}>
                    {h.column.getCanSort() ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 font-medium hover:text-night">
                        {label}
                        <span aria-hidden className="w-3 text-xs">
                          {sortIcon}
                        </span>
                      </button>
                    ) : (
                      label
                    )}
                  </Th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-rule last:border-0">
              {row.getVisibleCells().map((cell) => (
                <Td key={cell.id} className={cell.column.columnDef.meta?.className}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>

      {total === 0 && <div className="mt-3">{empty}</div>}

      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <p aria-live="polite">
            Showing {first}–{last} of {total}
          </p>
          {table.getPageCount() > 1 && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Extra classes for this column's header and cells (e.g. `text-right`). */
    className?: string;
  }
}
