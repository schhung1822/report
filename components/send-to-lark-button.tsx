"use client";

import { useState } from "react";
import { FileText, Image as ImageIcon, LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LARK_FORMAT_LABEL, type LarkFormat } from "@/lib/report-export";

const FORMAT_OPTIONS: { value: LarkFormat; label: string; hint: string; Icon: typeof FileText }[] = [
  { value: "image", label: "Ảnh PNG", hint: "Hiện ngay trong khung chat", Icon: ImageIcon },
  { value: "pdf", label: "File PDF", hint: "Nhiều trang, dễ lưu và in", Icon: FileText },
];

/**
 * "Gửi Lark" button with a confirmation step, since a message posted to a group can't be recalled from here.
 * The user picks the format (PNG picture or PDF file); the page supplies onConfirm (render the report in that
 * format and call sendReportToLark) and reports the outcome itself.
 */
export function SendToLarkButton({
  reportName,
  disabled = false,
  onConfirm,
}: {
  reportName: string;
  disabled?: boolean;
  onConfirm: (format: LarkFormat) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [format, setFormat] = useState<LarkFormat>("image");

  async function confirm() {
    setIsSending(true);
    try {
      await onConfirm(format);
    } finally {
      setIsSending(false);
      setOpen(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="lg" disabled={disabled || isSending} onClick={() => setOpen(true)}>
        {isSending ? <LoaderCircle className="animate-spin" /> : <Send />}
        Gửi Lark
      </Button>
      <Dialog open={open} onOpenChange={(next) => !isSending && setOpen(next)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Gửi báo cáo tới nhóm Lark?</DialogTitle>
            <DialogDescription>
              “{reportName}” được tạo từ số liệu đang hiển thị và gửi bằng bot tới nhóm Lark đã cấu hình. Tin đã gửi không
              thể thu hồi từ trang này.
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Định dạng gửi" className="grid grid-cols-2 gap-2">
            {FORMAT_OPTIONS.map(({ value, label, hint, Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={format === value}
                disabled={isSending}
                onClick={() => setFormat(value)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-colors disabled:opacity-60",
                  format === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="size-4" />
                  {label}
                </span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={isSending} onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button disabled={isSending} onClick={() => void confirm()}>
              {isSending ? <LoaderCircle className="animate-spin" /> : <Send />}
              {isSending ? "Đang gửi..." : `Gửi ${LARK_FORMAT_LABEL[format]}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
