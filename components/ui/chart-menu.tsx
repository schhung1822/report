"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A small dropdown for the chart headers (period, currency): a trigger button and a list of radio items.
 * `<ChartMenuTrigger asChild>` puts the open/close behaviour on its single child instead of adding a button.
 */
type MenuContextValue = { open: boolean; setOpen: (open: boolean) => void; triggerRef: React.RefObject<HTMLElement | null>; contentId: string }
const MenuContext = React.createContext<MenuContextValue | null>(null)
const useMenu = () => {
  const context = React.useContext(MenuContext)
  if (!context) throw new Error("ChartMenu parts must be used inside <ChartMenu>")
  return context
}

function ChartMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const contentId = React.useId()
  const value = React.useMemo(() => ({ open, setOpen, triggerRef, contentId }), [open, contentId])
  return (
    <MenuContext.Provider value={value}>
      <span className="relative inline-flex">{children}</span>
    </MenuContext.Provider>
  )
}

function ChartMenuTrigger({ children, asChild = false }: { children: React.ReactElement<Record<string, unknown>>; asChild?: boolean }) {
  const { open, setOpen, triggerRef, contentId } = useMenu()
  const props = {
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? contentId : undefined,
    "data-state": open ? "open" : "closed",
    onClick: (event: React.MouseEvent) => {
      ;(children.props.onClick as ((e: React.MouseEvent) => void) | undefined)?.(event)
      setOpen(!open)
    },
    ref: triggerRef,
  }
  if (asChild) return React.cloneElement(children, props)
  return (
    <button type="button" {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)} ref={triggerRef as React.Ref<HTMLButtonElement>}>
      {children}
    </button>
  )
}

function ChartMenuContent({ children, className }: { children: React.ReactNode; className?: string }) {
  const { open, setOpen, triggerRef, contentId } = useMenu()
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, setOpen, triggerRef])

  if (!open) return null
  return (
    <div
      ref={ref}
      id={contentId}
      role="menu"
      className={cn("absolute top-full right-0 z-50 mt-1.5 min-w-36 rounded-xl border border-border-soft bg-surface-white p-1 shadow-lg", className)}
    >
      {children}
    </div>
  )
}

type RadioContextValue = { value?: string; onValueChange?: (value: string) => void }
const RadioContext = React.createContext<RadioContextValue>({})

function ChartMenuRadioGroup({ value, onValueChange, children }: RadioContextValue & { children: React.ReactNode }) {
  return (
    <RadioContext.Provider value={{ value, onValueChange }}>
      <div role="group">{children}</div>
    </RadioContext.Provider>
  )
}

function ChartMenuRadioItem({ value, children }: { value: string; children: React.ReactNode }) {
  const group = React.useContext(RadioContext)
  const { setOpen } = useMenu()
  const checked = group.value === value
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={() => {
        group.onValueChange?.(value)
        setOpen(false)
      }}
      className={cn(
        "typo-label-02-medium flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-surface-base focus-visible:bg-surface-base",
        checked ? "text-fg-loud" : "text-fg-normal",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", checked ? "bg-primary-blue-500" : "bg-transparent")} aria-hidden="true" />
      {children}
    </button>
  )
}

export { ChartMenu, ChartMenuContent, ChartMenuRadioGroup, ChartMenuRadioItem, ChartMenuTrigger }
