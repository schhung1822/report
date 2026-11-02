"use client";

import { useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "Gửi Lark" button with a confirmation step, since a message posted to a group can't be recalled from here.
 * The page supplies onConfirm (render the report and call sendReportToLark) and reports the outcome itself.
 */
export function SendToLarkButton({
  reportName,
  disabled = false,
  onConfirm,
}: {
  reportName: string;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);

  async function confirm() {
    setIsSending(true);
    try {
      await onConfirm();
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
              Ảnh “{reportName}” được tạo từ số liệu đang hiển thị và gửi bằng bot tới nhóm Lark đã cấu hình. Tin đã gửi
              không thể thu hồi từ trang này.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={isSending} onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button disabled={isSending} onClick={() => void confirm()}>
              {isSending ? <LoaderCircle className="animate-spin" /> : <Send />}
              {isSending ? "Đang gửi..." : "Gửi ảnh"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
