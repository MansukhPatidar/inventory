"use client"

import * as React from "react"
import { Check, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Plain accessible checkbox styled to match the app's dark theme.
 *
 * There is no `@radix-ui/react-checkbox` dependency in this project and the
 * house rule is no new npm dependencies, so this wraps a native
 * `<input type="checkbox">` (real keyboard/focus/AT semantics for free)
 * rather than pulling in a library. Supports an `indeterminate` visual state
 * for header select-all controls, which a native checkbox only exposes via
 * the DOM property (not an attribute), so it's applied imperatively via ref.
 */
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  indeterminate?: boolean
}

function Checkbox({ className, indeterminate = false, checked, ...props }: CheckboxProps) {
  const ref = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <span
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border bg-background transition-colors",
        "has-[:checked]:border-primary has-[:checked]:bg-primary has-[:indeterminate]:border-primary has-[:indeterminate]:bg-primary",
        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        "has-[:disabled]:opacity-50 has-[:disabled]:pointer-events-none",
        className
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        data-slot="checkbox"
        checked={checked}
        className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none outline-none disabled:cursor-not-allowed"
        {...props}
      />
      {indeterminate ? (
        <Minus className="pointer-events-none absolute size-3 text-primary-foreground" />
      ) : (
        <Check className="pointer-events-none absolute hidden size-3 text-primary-foreground peer-checked:block" />
      )}
    </span>
  )
}

export { Checkbox }
