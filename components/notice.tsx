import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export type NoticeState = {
  type: "success" | "warning" | "error";
  message: string;
};

const ICONS = {
  success: { Icon: CircleCheck, className: "text-emerald-600" },
  warning: { Icon: TriangleAlert, className: "text-amber-600" },
  error: { Icon: CircleAlert, className: "" },
} as const;

export function Notice({ notice }: { notice: NoticeState | null }) {
  if (!notice) return null;
  const { Icon, className } = ICONS[notice.type];

  return (
    <Alert variant={notice.type === "error" ? "destructive" : "default"} className="print:hidden">
      <Icon className={cn(className)} aria-hidden="true" />
      <AlertDescription className={cn(notice.type !== "error" && "text-foreground")}>
        {notice.message}
      </AlertDescription>
    </Alert>
  );
}
