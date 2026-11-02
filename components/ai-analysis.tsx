"use client";

import { useState } from "react";
import { CircleAlert, ClipboardPaste, LoaderCircle, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AI_MODELS,
  MAX_FOCUS_LENGTH,
  type AiModelId,
  type AnalysisResult,
  type AnalyzeResponse,
  type Priority,
  type ReportType,
} from "@/lib/ai-analysis";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<AnalysisResult["status"], { label: string; className: string }> = {
  good: { label: "Tốt", className: "bg-emerald-50 text-emerald-700" },
  watch: { label: "Cần theo dõi", className: "bg-amber-50 text-amber-700" },
  risk: { label: "Có rủi ro", className: "bg-destructive/10 text-destructive" },
};

const PRIORITY_LABEL: Record<Priority, string> = { high: "Ưu tiên cao", medium: "Trung bình", low: "Thấp" };

const MODEL_ITEMS = AI_MODELS.map((model) => ({ value: model.id, label: model.label }));

type AiAnalysisPanelProps = {
  reportType: ReportType;
  /** Called when the user clicks analyze, so the request always reflects the data currently on screen. */
  getData: () => unknown;
  /** Optional: lets the user copy the AI summary into a text field of the report. */
  onUseSummary?: (text: string) => void;
};

export function AiAnalysisPanel({ reportType, getData, onUseSummary }: AiAnalysisPanelProps) {
  const [model, setModel] = useState<AiModelId>(AI_MODELS[0].id);
  const [focus, setFocus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function analyze() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, reportType, focus, data: JSON.stringify(getData()) }),
      });
      const json = (await response.json().catch(() => null)) as (AnalyzeResponse & { error?: string }) | null;
      if (!response.ok || !json) {
        throw new Error(json?.error ?? "Không thể phân tích lúc này. Vui lòng thử lại.");
      }
      setResult(json);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể phân tích lúc này. Vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  }

  const modelLabel = AI_MODELS.find((item) => item.id === result?.model)?.label;

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
          Phân tích AI
        </CardTitle>
        <CardDescription>Đánh giá tự động dựa trên số liệu đang hiển thị trong báo cáo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row">
          <Select items={MODEL_ITEMS} value={model} onValueChange={(value) => value && setModel(value as AiModelId)}>
            <SelectTrigger className="h-9 w-full md:w-48" aria-label="Mô hình AI">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_MODELS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
            maxLength={MAX_FOCUS_LENGTH}
            placeholder="Điều muốn AI tập trung (tuỳ chọn), ví dụ: chi phí ads, nhân sự lỗ..."
            aria-label="Yêu cầu bổ sung"
            className="h-9 flex-1"
          />
          <Button size="lg" className="h-9" disabled={isLoading} onClick={() => void analyze()}>
            {isLoading ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {isLoading ? "Đang phân tích..." : result ? "Phân tích lại" : "Phân tích"}
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <div className="space-y-5 border-t pt-5">
            {result.analysis ? (
              <AnalysisView
                analysis={result.analysis}
                modelLabel={modelLabel}
                onUseSummary={onUseSummary}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {modelLabel} không trả về đúng định dạng, hiển thị nguyên văn:
                </p>
                <div className="whitespace-pre-wrap rounded-lg border bg-muted/30 px-4 py-3 text-sm leading-6">{result.raw}</div>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AnalysisView({
  analysis,
  modelLabel,
  onUseSummary,
}: {
  analysis: AnalysisResult;
  modelLabel?: string;
  onUseSummary?: (text: string) => void;
}) {
  const status = STATUS_LABEL[analysis.status];

  function useSummary() {
    const lines = [analysis.summary];
    if (analysis.recommendations.length) {
      lines.push("", "Đề xuất:", ...analysis.recommendations.map((item) => `- ${item.action}`));
    }
    onUseSummary?.(lines.join("\n"));
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={cn("h-6 px-2.5", status.className)}>{status.label}</Badge>
          {modelLabel ? <span className="text-xs text-muted-foreground">bởi {modelLabel}</span> : null}
          {onUseSummary ? (
            <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={useSummary}>
              <ClipboardPaste />
              Dùng làm lời tổng kết
            </Button>
          ) : null}
        </div>
        <p className="text-sm leading-6">{analysis.summary}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ItemList title="Điểm tích cực" items={analysis.strengths} dotClass="bg-emerald-500" empty="Chưa ghi nhận điểm nổi bật." />
        <ItemList title="Rủi ro cần lưu ý" items={analysis.risks} dotClass="bg-destructive" empty="Không phát hiện rủi ro rõ rệt." />
      </div>

      {analysis.recommendations.length ? (
        <div>
          <h4 className="mb-2 text-sm font-medium">Khuyến nghị</h4>
          <ol className="divide-y rounded-lg border">
            {analysis.recommendations.map((item, index) => (
              <li key={index} className="flex gap-3 px-4 py-3">
                <span className="mt-0.5 text-xs font-medium tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.action}</p>
                  {item.reason ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.reason}</p> : null}
                </div>
                <Badge variant={item.priority === "high" ? "default" : "secondary"} className="shrink-0 self-start">
                  {PRIORITY_LABEL[item.priority]}
                </Badge>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Kết quả do AI tạo từ dữ liệu tại thời điểm phân tích, chỉ mang tính tham khảo. Hãy đối chiếu với số liệu gốc.
      </p>
    </>
  );
}

function ItemList({
  title,
  items,
  dotClass,
  empty,
}: {
  title: string;
  items: { title: string; detail: string }[];
  dotClass: string;
  empty: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <h4 className="text-sm font-medium">{title}</h4>
      {items.length ? (
        <ul className="mt-3 space-y-3">
          {items.map((item, index) => (
            <li key={index} className="flex gap-2.5">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", dotClass)} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.title}</p>
                {item.detail ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.detail}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
