import type { ReactNode } from "react";

/**
 * Shared accessibility scaffolding for the Recharts charts.
 *
 * A Recharts chart is a pile of <path> elements with no name and no text, and
 * its numbers live in a hover-only tooltip. So each chart gets two things: an
 * accessible name that states what the data actually does, and a
 * visually-hidden table carrying the same series in full.
 */

interface ChartFigureProps {
  /**
   * The chart's accessible name. Should summarise the real trend — direction,
   * range, notable values — not just name the chart.
   */
  label: string;
  /** The visually-hidden <ChartDataTable> carrying the same series. */
  table: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * `role="img"` collapses the whole SVG subtree into a single named node, which
 * is exactly right for chart geometry. It also means the data table has to be
 * a *sibling* of that node — nested inside, it would be pruned along with
 * everything else and the numbers would be unreachable again.
 */
export function ChartFigure({ label, table, className, children }: ChartFigureProps) {
  return (
    <>
      <div role="img" aria-label={label} className={className}>
        {children}
      </div>
      {table}
    </>
  );
}

interface ChartDataTableProps {
  /** Names the table for anyone landing on it out of context. */
  caption: string;
  columns: string[];
  /**
   * Pre-formatted cells, one array per row. The first cell of each row is the
   * row header (the month, date or category the rest of the row describes).
   */
  rows: string[][];
}

/**
 * The keyboard- and screen-reader-reachable equivalent of a chart. `sr-only`
 * keeps it out of the visual layout without removing it from the accessibility
 * tree the way `display: none` or `hidden` would.
 */
export function ChartDataTable({ caption, columns, rows }: ChartDataTableProps) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          // Row headers are usually unique (a date, a month, a category) but a
          // report spanning years can repeat a month label, so pair it with the
          // position rather than trusting it alone.
          <tr key={`${rowIndex}-${row[0]}`}>
            {row.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={index}>{cell}</td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "rose to", "fell to" or "stayed at" — for describing a first→last move. */
export function describeChange(first: number, last: number): string {
  if (last > first) return "rising to";
  if (last < first) return "falling to";
  return "flat at";
}

/** Formats a value range as "X to Y", collapsing to one value when equal. */
export function describeRange(
  values: number[],
  format: (value: number) => string
): string {
  if (values.length === 0) return "no data";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? format(min) : `${format(min)} to ${format(max)}`;
}
