"use client"

import * as React from "react"

type Options<T> = {
  /** The controlled value; leave it undefined to let the hook keep the state itself. */
  value?: T
  defaultValue: T
  onChange?: (value: T) => void
}

/** State that is either controlled by a parent (`value`) or kept here (`defaultValue`), with `onChange` for both. */
export function useControllableState<T>({ value, defaultValue, onChange }: Options<T>): [T, (next: T) => void] {
  const [internal, setInternal] = React.useState<T>(defaultValue)
  const controlled = value !== undefined
  const current = controlled ? (value as T) : internal

  const onChangeRef = React.useRef(onChange)
  React.useEffect(() => {
    onChangeRef.current = onChange
  })
  const currentRef = React.useRef(current)
  React.useEffect(() => {
    currentRef.current = current
  })

  const set = React.useCallback(
    (next: T) => {
      if (Object.is(next, currentRef.current)) return
      if (!controlled) setInternal(next)
      onChangeRef.current?.(next)
    },
    [controlled],
  )

  return [current, set]
}
