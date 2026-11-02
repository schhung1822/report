"use client";

import { ChangeEvent, DragEvent, useState } from "react";
import { FileSpreadsheet, LoaderCircle, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

type FileDropzoneProps = {
  fileName: string;
  isParsing: boolean;
  hint: string;
  onFile: (file: File) => void;
  /** "vertical" centers content for narrow sidebars; "horizontal" fits wide toolbars. */
  layout?: "vertical" | "horizontal";
  className?: string;
};

export function FileDropzone({
  fileName,
  isParsing,
  hint,
  onFile,
  layout = "horizontal",
  className,
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onFile(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  const Icon = isParsing ? LoaderCircle : fileName ? FileSpreadsheet : UploadCloud;
  const vertical = layout === "vertical";

  return (
    <label
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border border-dashed p-4 transition-colors has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50",
        vertical ? "min-h-40 flex-col items-center justify-center text-center" : "items-center",
        isDragging ? "border-primary bg-muted" : "bg-muted/30 hover:bg-muted/60",
        className,
      )}
    >
      <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleChange} />
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground",
          fileName && !isParsing && "text-emerald-600",
        )}
      >
        <Icon className={cn("size-5", isParsing && "animate-spin")} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {isParsing ? "Đang đọc dữ liệu..." : fileName || "Kéo thả file vào đây"}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {fileName && !isParsing ? "Bấm để chọn file khác" : hint}
        </span>
      </span>
    </label>
  );
}
