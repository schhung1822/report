"use client";

import { useState } from "react";
import { ClipboardPaste, Plus, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/costs/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDailyMoney, type Expense } from "@/lib/daily-report";
import { isFilledExpense, loadPayers, parseExpensePaste } from "@/lib/daily-expenses";

const LIST_ID = "expense-ledger-payers";

/** Names without blanks or repeats (ignoring case), first spelling kept. */
function distinct(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase("vi");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Type or paste the cash-out ledger ("Bảng kê chi phí xuất quỹ") of the daily report: payer, supplier / content, amount.
 * Enter in the amount of a row opens the next row with the same payer, so a list is typed without the mouse.
 */
export function ExpenseLedgerEditor({
  expenses,
  reportDate,
  onChange,
}: {
  expenses: Expense[];
  reportDate: string;
  onChange: (next: Expense[]) => void;
}) {
  const [pasteText, setPasteText] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [remembered, setRemembered] = useState<string[]>([]);

  const rows = expenses.length ? expenses : [{ payer: "", supplier: "", amount: 0 }];
  const filled = expenses.filter(isFilledExpense);
  const total = filled.reduce((sum, expense) => sum + expense.amount, 0);
  const payers = distinct([...expenses.map((expense) => expense.payer), ...remembered]);

  function update(index: number, patch: Partial<Expense>) {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addRow(payer = "", focusIndex?: number) {
    onChange([...rows, { payer, supplier: "", amount: 0 }]);
    if (focusIndex === undefined) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-ledger-row="${focusIndex}"] [data-field="supplier"]`)?.focus();
    });
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  function applyPaste() {
    const lastPayer = [...expenses].reverse().find((expense) => expense.payer.trim())?.payer ?? "";
    const { expenses: parsed, skipped } = parseExpensePaste(pasteText, lastPayer);
    if (!parsed.length) {
      setPasteNote(skipped.length ? `Không đọc được dòng nào (${skipped.length} dòng thiếu tên hoặc số tiền).` : "Chưa có nội dung để thêm.");
      return;
    }
    onChange([...expenses.filter(isFilledExpense), ...parsed]);
    setPasteText("");
    setPasteNote(
      `Đã thêm ${parsed.length} khoản chi${skipped.length ? `, bỏ qua ${skipped.length} dòng thiếu tên hoặc số tiền: ${skipped.slice(0, 3).join(" · ")}${skipped.length > 3 ? "…" : ""}` : ""}.`,
    );
  }

  return (
    <details open className="group rounded-xl border bg-card text-card-foreground print:hidden">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="text-sm font-semibold">Nhập bảng kê chi phí xuất quỹ</h2>
          <p className="text-xs text-muted-foreground">
            Ngày {reportDate || "—"} · {filled.length} khoản chi · tổng {formatDailyMoney(total)}
          </p>
        </div>
        <span className="text-xs text-muted-foreground group-open:hidden">Bấm để mở</span>
      </summary>

      <div className="space-y-3 border-t px-4 py-3">
        <datalist id={LIST_ID}>
          {payers.map((payer) => (
            <option key={payer} value={payer} />
          ))}
        </datalist>

        <div className="overflow-x-auto">
          <table className="w-full min-w-136 text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="w-10 pb-1 text-center font-medium">STT</th>
                <th className="w-[22%] pb-1 pr-2 font-medium">Người chi</th>
                <th className="pb-1 pr-2 font-medium">Tên NCC / nội dung chi</th>
                <th className="w-[24%] pb-1 pr-2 font-medium">Số tiền (₫)</th>
                <th className="w-8 pb-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} data-ledger-row={index} className="align-top">
                  <td className="py-1 pr-1 text-center text-xs tabular-nums text-muted-foreground">
                    <span className="inline-block pt-2">{index + 1}</span>
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      className="h-8 text-xs"
                      list={LIST_ID}
                      value={row.payer}
                      placeholder="Hưng"
                      aria-label={`Người chi dòng ${index + 1}`}
                      onFocus={() => setRemembered(loadPayers())}
                      onChange={(event) => update(index, { payer: event.target.value })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      className="h-8 text-xs"
                      data-field="supplier"
                      value={row.supplier}
                      placeholder="Nhung rubi"
                      aria-label={`Tên nhà cung cấp dòng ${index + 1}`}
                      onChange={(event) => update(index, { supplier: event.target.value })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <MoneyInput
                      className="h-8 text-right text-xs tabular-nums"
                      value={row.amount ? String(row.amount) : ""}
                      placeholder="0"
                      aria-label={`Số tiền dòng ${index + 1}`}
                      onValueChange={(raw) => update(index, { amount: Math.floor(Number(raw) || 0) })}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        if (index < rows.length - 1) {
                          document.querySelector<HTMLInputElement>(`[data-ledger-row="${index + 1}"] [data-field="supplier"]`)?.focus();
                        } else if (isFilledExpense(row)) {
                          addRow(row.payer, index + 1);
                        }
                      }}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <Button variant="ghost" size="icon-xs" className="mt-1 text-muted-foreground" aria-label={`Xóa dòng ${index + 1}`} onClick={() => removeRow(index)}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t">
                <td colSpan={3} className="pt-2 pr-2 text-right text-xs text-muted-foreground">
                  Tổng chi nhà cung cấp
                </td>
                <td className="pt-2 pr-2 text-right text-sm font-semibold tabular-nums">{formatDailyMoney(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => addRow(rows[rows.length - 1]?.payer ?? "", rows.length)}>
            <Plus />
            Thêm dòng
          </Button>
          {payers.slice(0, 6).map((payer) => (
            <Button key={payer} variant="secondary" size="xs" onClick={() => addRow(payer, rows.length)}>
              <Plus />
              {payer}
            </Button>
          ))}
          {filled.length > 0 && (
            <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => onChange([])}>
              Xóa hết
            </Button>
          )}
        </div>

        <details className="rounded-lg border bg-muted/30 p-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium [&::-webkit-details-marker]:hidden">
            <ClipboardPaste className="size-3.5" aria-hidden="true" />
            Dán nhiều dòng từ Excel / Google Sheets / tin nhắn
          </summary>
          <div className="mt-2 space-y-2">
            <textarea
              className="min-h-24 w-full rounded-lg border border-input bg-background px-2.5 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={"Hưng\tNhung rubi\t1.250.000\nHưng\tLưu giày\t860.000\nA Kiên\tKho Thành Công\t2.400.000"}
              aria-label="Dán bảng kê chi phí"
            />
            <p className="text-[11px] text-muted-foreground">
              Mỗi dòng là một khoản chi, 3 cột Người chi · Tên NCC · Số tiền (copy thẳng từ Excel). Chỉ có 2 cột (Tên NCC · Số tiền) thì dùng người chi của dòng trên. Dòng dạng &quot;Nhung rubi 1.250.000&quot; cũng đọc được.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!pasteText.trim()} onClick={applyPaste}>
                Thêm vào bảng kê
              </Button>
              {pasteNote && <span className="text-[11px] text-muted-foreground">{pasteNote}</span>}
            </div>
          </div>
        </details>

        <p className="text-[11px] text-muted-foreground">
          Bảng kê được nhớ theo ngày báo cáo trên trình duyệt này. Lấy lại dữ liệu từ POS sẽ không làm mất các khoản đã nhập của ngày đó.
        </p>
      </div>
    </details>
  );
}
