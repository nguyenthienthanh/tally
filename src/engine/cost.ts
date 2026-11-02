import type { UsageEvent } from '../types.js'
import { CcError } from '../errors.js'
import {
  PRICING, CACHE_WRITE_5M_FACTOR, CACHE_WRITE_1H_FACTOR,
  CACHE_READ_FACTOR, CACHE_READ_FACTOR_DEFAULT,
} from '../data/pricing.js'

export type CostInput = Pick<UsageEvent,
  'model' | 'input_tokens' | 'output_tokens' | 'cache_read' | 'cache_write_5m' | 'cache_write_1h'>

export const UNKNOWN = '__unknown__'

export function hasPricing(model: string): boolean {
  return Object.hasOwn(PRICING, model)
}

/**
 * USD tương đương API. Công thức đã đối chiếu KHỚP 0.000000% với `total_cost_usd`
 * do `claude -p --output-format json` báo (claude-opus-5, 2026-10-29).
 */
export function costOfEvent(e: CostInput): number {
  const p = PRICING[e.model]
  if (!p) throw new CcError('UNKNOWN_MODEL_PRICING', `không có giá cho model: ${e.model}`)
  const readFactor = CACHE_READ_FACTOR[e.model] ?? CACHE_READ_FACTOR_DEFAULT
  return (
    e.input_tokens * p.in +
    e.output_tokens * p.out +
    e.cache_write_5m * CACHE_WRITE_5M_FACTOR * p.in +
    e.cache_write_1h * CACHE_WRITE_1H_FACTOR * p.in +
    e.cache_read * readFactor * p.in
  ) / 1_000_000
}

/** Model không có giá ⇒ gom vào `__unknown__` với $0 (không bịa giá), vẫn đếm được lượt. */
export function costByModel(events: UsageEvent[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of events) {
    if (!hasPricing(e.model)) { out[UNKNOWN] = (out[UNKNOWN] ?? 0); continue }
    out[e.model] = (out[e.model] ?? 0) + costOfEvent(e)
  }
  return out
}
