'use client'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Icon-only button wrapped in a Base UI tooltip.
 *
 * Hydration note (audit 2026-11-12): Base UI derives the trigger id from
 * React.useId(), i.e. from the component's position in the tree. That is
 * deterministic as long as server and client render the same tree, which the
 * live app does (verified: SSR HTML ids are byte-identical across requests and
 * match the hydrated DOM). The `id` prop is therefore routed to
 * `TooltipTrigger`'s supported `id` override — Base UI's sanctioned way to pin
 * the trigger id — instead of being spread onto the rendered <button>, where
 * it would fight Base UI's own id during prop merging. Passing a stable,
 * caller-owned id makes this component's markup immune to unrelated wrapper
 * changes elsewhere in the tree; omitting it keeps proper React useId
 * generation. Nothing is hardcoded either way.
 */
export function IconButton({ label, children, className, id, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger id={id} render={<button type="button" className={cn('tiny-icon', className)} aria-label={label} {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
