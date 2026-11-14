"use client";

import { useMemo, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { LoaderCircle, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CHANNEL_NAME,
  SHEET_CHANNELS,
  SHEET_COLUMNS,
  SHEET_COVERAGE,
  isAmountText,
  parseAmountText,
  type SheetCell,
  type SheetChannel,
  type SheetMarket,
} from "@/lib/costs/daily-sheet";
import { listDays, toDmy } from "@/lib/pancake/dates";
import { cn } from "@/lib/utils";

/** A grid of more days than this is too long to type into: the Excel file is the better tool. */
const MAX_GRID_DAYS = 93;
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const keyOf = (date: string, channel: SheetChannel, line: string) => `${date}|${channel}|${line}`;

/**
 * The accountant's daily costs typed straight into a table: one row per day (and channel), one column per cost. It shows what
 * is stored, marks what was changed, accepts a block pasted from Excel and saves only the cells that changed. A blank cell
 * keeps the stored value; type 0 to store zero.
 */
export function DailyCostGrid({
  market,
  from,
  to,
  stored,
  loading,
  disabled,
  saving,
  onSave,
  money,
  unit,
}: {
  market: SheetMarket;
  from: string;
  to: string;
  stored: SheetCell[];
  loading: boolean;
  disabled: boolean;
  saving: boolean;
  /** Resolves true when the cells were saved (the typed values are then dropped: they are stored now). */
  onSave: (cells: SheetCell[]) => Promise<boolean>;
  money: Intl.NumberFormat;
  unit: string;
}) {
  const columns = SHEET_COLUMNS[market];
  const channels = SHEET_CHANNELS[market];
  const days = useMemo(() => (from && to && from <= to ? listDays(from, to) : []), [from, to]);
  const tooLong = days.length > MAX_GRID_DAYS;
  const rows = useMemo(() => (tooLong ? [] : days.flatMap((date) => channels.map((channel) => ({ date, channel })))), [days, channels, tooLong]);

  const storedByKey = useMemo(() => new Map(stored.map((cell) => [keyOf(cell.date, cell.channel, cell.line), cell.amount])), [stored]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const typed = (key: string) => drafts[key]?.trim() ?? "";
  /** What a cell counts as now: what was typed if it is a valid number, otherwise what is stored. */
  const effective = (key: string) => {
    const text = typed(key);
    return text !== "" && isAmountText(text) ? parseAmountText(text) : (storedByKey.get(key) ?? 0);
  };

  const { changes, invalid } = useMemo(() => {
    const result: SheetCell[] = [];
    let bad = 0;
    for (const row of rows) {
      for (const column of columns) {
        const key = keyOf(row.date, row.channel, column.line);
        const text = drafts[key]?.trim() ?? "";
        if (text === "") continue;
        if (!isAmountText(text)) {
          bad += 1;
          continue;
        }
        const amount = parseAmountText(text);
        if (storedByKey.get(key) !== amount) result.push({ date: row.date, channel: row.channel, line: column.line, amount });
      }
    }
    return { changes: result, invalid: bad };
  }, [rows, columns, drafts, storedByKey]);

  const coverage = SHEET_COVERAGE[market].map((group) => {
    const covered = days.filter((date) => channels.some((channel) => group.lines.some((line) => effective(keyOf(date, channel, line)) > 0))).length;
    return { label: group.label, covered, total: days.length };
  });

  async function save() {
    if (await onSave(changes)) setDrafts({});
  }

  function paste(event: ClipboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) {
    const text = event.clipboardData.getData("text").replace(/\r/g, "").replace(/\n+$/, "");
    if (!/[\t\n]/.test(text)) return; // one value: the normal paste
    event.preventDefault();
    setDrafts((current) => {
      const next = { ...current };
      text.split("\n").forEach((line, down) => {
        line.split("\t").forEach((value, across) => {
          const row = rows[rowIndex + down];
          const column = columns[columnIndex + across];
          if (row && column) next[keyOf(row.date, row.channel, column.line)] = value.trim();
        });
      });
      return next;
    });
  }

  function move(event: KeyboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) {
    const step = event.key === "Enter" || event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    document.getElementById(`daily-cell-${rowIndex + step}-${columnIndex}`)?.focus();
  }

  if (!days.length) {
    return <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">Chọn khoảng ngày ở thanh bên để nhập chi phí.</p>;
  }
  if (tooLong) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
        Khoảng {days.length} ngày quá dài để nhập trực tiếp. Chọn khoảng ngắn hơn (tối đa {MAX_GRID_DAYS} ngày, ví dụ một tháng) hoặc dùng file Excel.
      </p>
    );
  }

  const columnTotal = (line: string) => Math.round(rows.reduce((sum, row) => sum + effective(keyOf(row.date, row.channel, line)), 0) * 100) / 100;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {coverage.map((item) => (
            <span
              key={item.label}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px]",
                item.covered === item.total ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900",
              )}
            >
              {item.label}: <strong className="tabular-nums">{item.covered}/{item.total}</strong> ngày có số
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground">
            {loading ? "Đang tải…" : changes.length ? `${changes.length} ô đã sửa, chưa lưu` : "Gõ vào ô hoặc dán cả khối từ Excel, rồi bấm Lưu."}
          </span>
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" disabled={saving || !Object.keys(drafts).length} onClick={() => setDrafts({})}>
            <Undo2 />
            Bỏ thay đổi
          </Button>
          <Button size="sm" disabled={disabled || saving || loading || !changes.length || invalid > 0} onClick={() => void save()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Lưu {changes.length ? `${changes.length} ô` : ""}
          </Button>
        </div>
      </div>
      {invalid ? <p className="text-xs text-destructive">{invalid} ô không phải số (chỉ gõ chữ số, dấu chấm hoặc phẩy). Sửa trước khi lưu.</p> : null}

      <div className="max-h-136 overflow-auto rounded-lg border">
        <Table className="text-xs">
          <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur [&_th]:h-auto [&_th]:px-2 [&_th]:py-2 [&_th]:align-bottom [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-24">Ngày</TableHead>
              {market === "VND" ? <TableHead className="w-16">Kênh</TableHead> : null}
              {columns.map((column) => (
                <TableHead key={column.line} className="min-w-32 text-right" title={column.hint}>
                  {column.header}
                  {column.essential ? <span className="block text-[10px] font-normal text-amber-700">cần nhập</span> : null}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="[&_td]:px-2 [&_td]:py-1">
            {rows.map((row, rowIndex) => {
              const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay();
              const firstOfDay = channels.length === 1 || row.channel === channels[0];
              return (
                <TableRow key={`${row.date}|${row.channel}`} className={cn(firstOfDay && rowIndex > 0 && channels.length > 1 && "border-t-2")}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {firstOfDay ? (
                      <>
                        {toDmy(row.date)} <span className={cn("text-[10px] font-normal", weekday === 0 ? "text-destructive" : "text-muted-foreground")}>{WEEKDAYS[weekday]}</span>
                      </>
                    ) : null}
                  </TableCell>
                  {market === "VND" ? <TableCell>{row.channel ? CHANNEL_NAME[row.channel] : ""}</TableCell> : null}
                  {columns.map((column, columnIndex) => {
                    const key = keyOf(row.date, row.channel, column.line);
                    const storedAmount = storedByKey.get(key);
                    const text = drafts[key];
                    const edited = text !== undefined && text.trim() !== "" && (!isAmountText(text.trim()) || storedAmount !== parseAmountText(text));
                    const bad = text !== undefined && text.trim() !== "" && !isAmountText(text.trim());
                    return (
                      <TableCell key={column.line}>
                        <input
                          id={`daily-cell-${rowIndex}-${columnIndex}`}
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`${column.header} ngày ${toDmy(row.date)}${row.channel ? ` kênh ${CHANNEL_NAME[row.channel]}` : ""}`}
                          aria-invalid={bad || undefined}
                          disabled={disabled || loading}
                          placeholder={storedAmount === undefined ? "" : money.format(storedAmount)}
                          value={text ?? (storedAmount === undefined ? "" : String(storedAmount))}
                          onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                          onPaste={(event) => paste(event, rowIndex, columnIndex)}
                          onKeyDown={(event) => move(event, rowIndex, columnIndex)}
                          className={cn(
                            "h-7 w-full rounded-md border border-transparent bg-transparent px-2 text-right tabular-nums outline-none hover:border-input focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/40 disabled:opacity-50",
                            storedAmount !== undefined && !edited && "bg-muted/40",
                            edited && "border-amber-400 bg-amber-50",
                            bad && "border-destructive bg-destructive/5",
                          )}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={market === "VND" ? 2 : 1} className="font-semibold">
                Tổng
              </TableCell>
              {columns.map((column) => (
                <TableCell key={column.line} className="text-right font-semibold tabular-nums">
                  {money.format(columnTotal(column.line))} <span className="text-[10px] font-normal text-muted-foreground">{unit}</span>
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
