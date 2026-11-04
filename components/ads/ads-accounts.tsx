"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { labelsOf, MARKET_LABEL, type AdsAccountLabel, type AdsMarket } from "@/lib/ads/label-types"
import type { AdsAccount } from "@/lib/ads/types"
import { cn } from "@/lib/utils"

type AccountsState = { accounts: AdsAccount[]; configured: boolean; loading: boolean; error: string | null }

/** The ad accounts the Ads MCP lets us read, loaded once per mount. */
export function useAdsAccounts(enabled = true): AccountsState {
  const [state, setState] = useState<AccountsState>({ accounts: [], configured: true, loading: enabled, error: null })
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch("/api/ads/accounts", { method: "POST" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { accounts?: AdsAccount[]; configured?: boolean; error?: string } | null
        if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.")
        if (!cancelled) setState({ accounts: payload.accounts ?? [], configured: payload.configured !== false, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ accounts: [], configured: true, loading: false, error: error instanceof Error ? error.message : "Không tải được tài khoản quảng cáo." })
      })
    return () => {
      cancelled = true
    }
  }, [enabled])
  return state
}

/** A list of ids kept in this browser (an unsent preference, not data): survives a reload, never reaches the server. */
export function useStoredIds(key: string): [string[], (ids: string[]) => void] {
  // Read once on the first browser render. The ids only show up in markup after the accounts have loaded, which is
  // always after hydration, so server and browser markup never disagree.
  const [ids, setIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown
      return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []
    } catch {
      // storage can be blocked or hold junk: start with nothing chosen
      return []
    }
  })
  const update = (next: string[]) => {
    setIds(next)
    try {
      window.localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // not being able to remember the choice must not break the form
    }
  }
  return [ids, update]
}

/** Checkbox list of ad accounts, with shortcuts to take every account of the report currency or none. */
export function AdsAccountPicker({
  accounts,
  selected,
  onChange,
  disabled = false,
  currencyOnly,
  labels = [],
  className,
}: {
  accounts: AdsAccount[]
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  /** Only accounts in this currency can be picked (the others are shown greyed out). */
  currencyOnly?: string
  /** The saved account labels: shown on each row, and offered as shortcuts to select the accounts of a shop. */
  labels?: AdsAccountLabel[]
  className?: string
}) {
  const usable = (account: AdsAccount) => !currencyOnly || account.currency === currencyOnly
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  const labelNames = (id: string) =>
    labels
      .filter((label) => label.accountId === id)
      .map((label) => (label.market === "VN" && label.channel ? `${MARKET_LABEL.VN} · ${label.channel === "zalo" ? "Zalo" : "Page"}` : MARKET_LABEL[label.market]))
  const selectMarket = (market: AdsMarket) => onChange(labelsOf(labels, market).map((label) => label.accountId).filter((id) => accounts.some((account) => account.id === id && usable(account))))
  const ordered = [...accounts].sort((a, b) => Number(usable(b)) - Number(usable(a)) || a.name.localeCompare(b.name, "vi"))

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap gap-1">
        {(["VN", "PH"] as const).map((market) =>
          labelsOf(labels, market).length ? (
            <Button key={market} type="button" variant="outline" size="xs" disabled={disabled} onClick={() => selectMarket(market)}>
              {MARKET_LABEL[market]} ({labelsOf(labels, market).length})
            </Button>
          ) : null,
        )}
        <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={() => onChange(accounts.filter(usable).map((account) => account.id))}>
          Chọn tất cả{currencyOnly ? ` ${currencyOnly}` : ""}
        </Button>
        <Button type="button" variant="outline" size="xs" disabled={disabled || !selected.length} onClick={() => onChange([])}>
          Bỏ chọn
        </Button>
      </div>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border p-1">
        {ordered.map((account) => {
          const allowed = usable(account)
          return (
            <li key={account.id}>
              <label className={cn("flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted", !allowed && "cursor-not-allowed opacity-50")}>
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 shrink-0"
                  checked={selected.includes(account.id)}
                  disabled={disabled || !allowed}
                  onChange={() => toggle(account.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{account.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {account.id} · {account.currency}
                    {account.status !== "active" ? ` · ${account.status}` : ""}
                  </span>
                  {labelNames(account.id).length ? <span className="block truncate text-[10px] font-medium text-primary">{labelNames(account.id).join(" + ")}</span> : null}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
