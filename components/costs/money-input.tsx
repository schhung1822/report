"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";

/** "1234567.5" -> "1.234.567,5": thousands grouped with dots, the decimal comma the way the reports write money. */
export function formatMoneyText(raw: string) {
  const [integer, decimals] = raw.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals === undefined ? grouped : `${grouped},${decimals}`;
}

/** What was typed -> "1234567.5": digits, and at most two decimals after the first comma. Dots are only separators. */
export function parseMoneyText(text: string) {
  const [integer = "", ...rest] = text.replace(/[^\d,]/g, "").split(",");
  const digits = integer.replace(/^0+(?=\d)/, "");
  return rest.length ? `${digits || "0"}.${rest.join("").slice(0, 2)}` : digits;
}

type Props = Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  /** The amount as plain digits ("1234567.5"); empty for nothing typed. */
  value: string;
  onValueChange: (raw: string) => void;
};

/** An amount field that shows the thousands separators while typing. The value it reports has none. */
export function MoneyInput({ value, onValueChange, ...props }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  // Re-grouping the digits moves the text under the caret: put the caret back after the same digits.
  useLayoutEffect(() => {
    const input = ref.current;
    if (caret.current !== null && input && document.activeElement === input) input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return (
    <Input
      {...props}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={formatMoneyText(value)}
      onChange={(event) => {
        const text = event.target.value;
        const before = text.slice(0, event.target.selectionStart ?? text.length).replace(/[^\d,]/g, "").length;
        const raw = parseMoneyText(text);
        const formatted = formatMoneyText(raw);
        let position = 0;
        for (let seen = 0; position < formatted.length && seen < before; position += 1) {
          if (/[\d,]/.test(formatted[position])) seen += 1;
        }
        caret.current = position;
        onValueChange(raw);
      }}
    />
  );
}
