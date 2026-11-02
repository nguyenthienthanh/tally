import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CREDITS_PER_MTOK_FALLBACK, FIVE_HOUR_CREDITS_FALLBACK, CREDITS_AS_OF,
} from './data/credits-fallback.js'

export interface PlanInfo {
  tier: string | null
  org_type: string | null
  billing_type: string | null
  mode: 'subscription' | 'api'
  ceiling: number | null
  credits_per_mtok: Record<string, number>
  /** 'live' = đọc từ ~/.claude.json · 'fallback' = bảng kèm repo. UI PHẢI nói rõ. */
  credits_source: 'live' | 'fallback'
  credits_as_of: string
}

export interface LiveLimits {
  five_hour_pct: number
  seven_day_pct: number
  five_hour_reset: number
  seven_day_reset: number
  captured_at: number
  /** phút kể từ lúc chụp — UI phải nói "số liệu cũ" nếu > 15 (AC-1.1) */
  age_minutes: number
}

const readJson = <T>(p: string): T | null => {
  try { return JSON.parse(readFileSync(p, 'utf8')) as T } catch { return null }
}

export function claudeHome(): string { return join(homedir(), '.claude') }
export function usageDataDir(): string { return join(claudeHome(), 'usage-data') }

export function readPlan(configPath = join(homedir(), '.claude.json')): PlanInfo {
  const cfg = readJson<Record<string, any>>(configPath)
  const oa = cfg?.['oauthAccount'] as Record<string, unknown> | undefined
  const tally = cfg?.['cachedGrowthBookFeatures']?.['tengu_amber_tally'] as
    { fiveHourCredits?: Record<string, number>; creditsPerMillionTokens?: Record<string, number> } | undefined

  const tier = (oa?.['organizationRateLimitTier'] as string | undefined)
    ?? (oa?.['userRateLimitTier'] as string | undefined) ?? null
  const live = tally?.creditsPerMillionTokens
  const cpm = live && Object.keys(live).length > 0 ? live : CREDITS_PER_MTOK_FALLBACK
  const ceilings = tally?.fiveHourCredits ?? FIVE_HOUR_CREDITS_FALLBACK

  return {
    tier,
    org_type: (oa?.['organizationType'] as string | undefined) ?? null,
    billing_type: (oa?.['billingType'] as string | undefined) ?? null,
    mode: oa ? 'subscription' : 'api',
    ceiling: tier ? (ceilings[tier] ?? null) : null,
    credits_per_mtok: cpm,
    credits_source: live && Object.keys(live).length > 0 ? 'live' : 'fallback',
    credits_as_of: CREDITS_AS_OF,
  }
}

export function readLiveLimits(p = join(claudeHome(), 'cache', 'rate-limits.json')): LiveLimits | null {
  const j = readJson<Omit<LiveLimits, 'age_minutes'>>(p)
  if (!j) return null
  let capturedAt = j.captured_at
  if (!capturedAt) { try { capturedAt = Math.floor(statSync(p).mtimeMs / 1000) } catch { capturedAt = 0 } }
  return { ...j, captured_at: capturedAt, age_minutes: (Date.now() / 1000 - capturedAt) / 60 }
}

export function readCycleCost(p = join(claudeHome(), 'cache', 'usage-cycle.json')):
  { cycle_cost: number; cycle_start: string; days_total: number; days_elapsed: number } | null {
  return readJson(p)
}
