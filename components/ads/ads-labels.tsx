"use client"

import { useCallback, useEffect, useState } from "react"
import { LoaderCircle, Tags } from "lucide-react"
import { Notice, type NoticeState } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CHANNEL_LABEL, MARKET_LABEL, type AdsAccountLabel, type AdsChannel, type AdsMarket } from "@/lib/ads/label-types"
import type { AdsAccount } from "@/lib/ads/types"
import { cn } from "@/lib/utils"

type LabelsState = { labels: AdsAccountLabel[]; configured: boolean; loading: boolean; error: string | null }

/** The saved account labels (which ad accounts run for which shop), with a way to store a new set. */
export function useAdsLabels() {
  const [state, setState] = useState<LabelsState>({ labels: [], configured: true, loading: true, error: null })
  useEffect(() => {
    let cancelled = false
    fetch("/api/ads/labels")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { labels?: AdsAccountLabel[]; configured?: boolean; error?: string } | null
        if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.")
        if (!cancelled) setState({ labels: payload.labels ?? [], configured: payload.configured !== false, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ labels: [], configured: true, loading: false, error: error instanceof Error ? error.message : "Không tải được nhãn tài khoản." })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(async (labels: AdsAccountLabel[]) => {
    const response = await fetch("/api/ads/labels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels }),
    })
    const payload = (await response.json().catch(() => null)) as { labels?: AdsAccountLabel[]; error?: string } | null
    if (!response.ok || !payload?.labels) throw new Error(payload?.error ?? "Không thể lưu nhãn.")
    setState((current) => ({ ...current, labels: payload.labels as AdsAccountLabel[], error: null }))
  }, [])

  return { ...state, save }
}

/** One row of the editor: is the account used for the Vietnam shop (and for which channel), and/or for the Phil shop. */
type Draft = { vn: boolean; channel: AdsChannel | ""; ph: boolean }

function draftsFrom(labels: AdsAccountLabel[]) {
  const drafts = new Map<string, Draft>()
  for (const label of labels) {
    const draft = drafts.get(label.accountId) ?? { vn: false, channel: "", ph: false }
    if (label.market === "VN") {
      draft.vn = true
      draft.channel = label.channel ?? ""
    } else draft.ph = true
    drafts.set(label.accountId, draft)
  }
  return drafts
}

function labelsFrom(drafts: Map<string, Draft>): AdsAccountLabel[] {
  const labels: AdsAccountLabel[] = []
  for (const [accountId, draft] of drafts) {
    if (draft.vn) labels.push({ accountId, market: "VN", channel: draft.channel || null })
    if (draft.ph) labels.push({ accountId, market: "PH", channel: null })
  }
  return labels
}

const selectClass =
  "h-7 rounded-md border border-input bg-transparent px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"

export function AdsLabelsDialog({
  open,
  onOpenChange,
  accounts,
  labels,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: AdsAccount[]
  labels: AdsAccountLabel[]
  onSave: (labels: AdsAccountLabel[]) => Promise<void>
}) {
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => draftsFrom(labels))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<NoticeState | null>(null)

  // every time the dialog opens it starts from what is saved
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      setDrafts(draftsFrom(labels))
      setNotice(null)
    }, 0)
    return () => clearTimeout(timer)
  }, [open, labels])

  const draftOf = (id: string): Draft => drafts.get(id) ?? { vn: false, channel: "", ph: false }
  const change = (id: string, patch: Partial<Draft>) => setDrafts((current) => new Map(current).set(id, { ...draftOf(id), ...patch }))
  // an account usable by a report is one in dong: the reports add its spend to dong costs
  const usable = (account: AdsAccount) => account.currency === "VND"
  const ordered = [...accounts].sort((a, b) => Number(usable(b)) - Number(usable(a)) || a.name.localeCompare(b.name, "vi"))
  const pending = labelsFrom(drafts)
  const missingChannel = pending.filter((label) => label.market === "VN" && !label.channel).length

  async function save() {
    setSaving(true)
    setNotice(null)
    try {
      await onSave(pending)
      onOpenChange(false)
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể lưu nhãn." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Gắn nhãn tài khoản quảng cáo</DialogTitle>
          <DialogDescription>
            Báo cáo của mỗi shop tự lấy chi tiêu từ các tài khoản gắn nhãn cho shop đó. Shop Việt: chọn thêm kênh Zalo/Page để chi tiêu vào đúng chi phí quảng cáo của kênh. Shop Phil: chi tiêu (₫) được đổi ra peso theo tỷ giá từng ngày.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Tài khoản quảng cáo</th>
                <th className="px-3 py-2 text-left font-medium">{MARKET_LABEL.VN}</th>
                <th className="px-3 py-2 text-left font-medium">{MARKET_LABEL.PH}</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((account) => {
                const draft = draftOf(account.id)
                const allowed = usable(account)
                return (
                  <tr key={account.id} className={cn("border-t", !allowed && "opacity-50")}>
                    <td className="px-3 py-2">
                      <span className="block font-medium">{account.name}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {account.id} · {account.currency}
                        {allowed ? "" : " · chưa hỗ trợ (không phải VND)"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`${account.name}: dùng cho ${MARKET_LABEL.VN}`}
                          className="size-3.5"
                          checked={draft.vn}
                          disabled={!allowed || saving}
                          onChange={(event) => change(account.id, { vn: event.target.checked })}
                        />
                        <select
                          aria-label={`${account.name}: kênh của ${MARKET_LABEL.VN}`}
                          className={selectClass}
                          value={draft.channel}
                          disabled={!allowed || !draft.vn || saving}
                          onChange={(event) => change(account.id, { channel: event.target.value as AdsChannel | "" })}
                        >
                          <option value="">Chưa chọn kênh</option>
                          {(Object.keys(CHANNEL_LABEL) as AdsChannel[]).map((channel) => (
                            <option key={channel} value={channel}>
                              {CHANNEL_LABEL[channel]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`${account.name}: dùng cho ${MARKET_LABEL.PH}`}
                        className="size-3.5"
                        checked={draft.ph}
                        disabled={!allowed || saving}
                        onChange={(event) => change(account.id, { ph: event.target.checked })}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {missingChannel ? (
          <p className="text-[11px] text-amber-700">
            {missingChannel} tài khoản shop Việt chưa chọn kênh: chi tiêu của chúng chưa vào báo cáo quản trị (chỉ tính vào ROAS ở báo cáo Phân tích vận hành).
          </p>
        ) : null}
        <Notice notice={notice} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Tags />}
            Lưu nhãn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Shop Việt · Zalo", "Shop Phil": the text of a label as the lists show it. */
export function labelText(label: { market: AdsMarket; channel: AdsChannel | null }) {
  return label.market === "VN" && label.channel ? `${MARKET_LABEL.VN} · ${CHANNEL_LABEL[label.channel]}` : MARKET_LABEL[label.market]
}
