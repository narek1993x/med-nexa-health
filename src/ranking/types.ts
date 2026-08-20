/**
 * Shared TypeScript types for the MedNexa Health ranking service.
 * All types are strict interfaces — no `any`, no optional chains on required fields.
 */

// ---------------------------------------------------------------------------
// Provider offer (raw shape returned by each provider endpoint)
// ---------------------------------------------------------------------------

export interface Offer {
  offer_id: string
  provider_id: string
  service_code: string
  city: string
  currency: string
  price_amount: number
  earliest_slot_utc: string // ISO-8601 UTC datetime
  wait_hours: number
  distance_km: number
  quality_score: number // 0–100
  insurance_plans: string[]
}

// ---------------------------------------------------------------------------
// Provider registry (loaded from PROVIDER_REGISTRY env var)
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  provider_id: string
  offers_url: string
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Ranking request (parsed from GET /best-care-options query params)
// ---------------------------------------------------------------------------

export interface RankingRequest {
  service_code: string
  city: string
  patient_currency: string
  max_distance_km: number
  max_wait_hours: number
  insurance_plan?: string // optional
}

// ---------------------------------------------------------------------------
// Scored offer (intermediate — after FX conversion + scoring applied)
// ---------------------------------------------------------------------------

export interface ScoredOffer extends Offer {
  converted_price: number // price in patient_currency
  effective_price: number // after insurance discount if applicable
  wait_score: number // 0–1
  distance_score: number // 0–1
  value_score: number // composite ranking metric
  insurance_applied: boolean // whether the 15% discount was applied
}

// ---------------------------------------------------------------------------
// Ranked offer (final — included in API response)
// ---------------------------------------------------------------------------

export interface RankedOffer {
  rank: number
  offer_id: string
  provider_id: string
  effective_price: number
  wait_hours: number
  distance_km: number
  quality_score: number
  value_score: number
  reason_code: ReasonCode
  reason: string
}

// ---------------------------------------------------------------------------
// Reason codes for ranking explanation
// ---------------------------------------------------------------------------

export type ReasonCode =
  | 'TOP_VALUE_SCORE'
  | 'BEST_PRICE'
  | 'BEST_QUALITY'
  | 'SHORTEST_WAIT'
  | 'CLOSEST_DISTANCE'

// ---------------------------------------------------------------------------
// API response shape for GET /best-care-options
// ---------------------------------------------------------------------------

export interface RankingResponse {
  request_id: string
  service_code: string
  city: string
  patient_currency: string
  results: RankedOffer[]
  warning?: string // populated when pipeline yields no results or providers are degraded
}

// ---------------------------------------------------------------------------
// FX rate table type
// ---------------------------------------------------------------------------

export type FxTable = Record<string, Record<string, number>>

// ---------------------------------------------------------------------------
// Config options response shape for GET /config/options
// ---------------------------------------------------------------------------

export interface ConfigOptions {
  service_codes: string[] // unique service codes from all provider offers, sorted alphabetically
  cities: string[] // unique cities from all provider offers, sorted alphabetically
  currencies: string[] // unique currencies from all provider offers, sorted alphabetically
  insurance_plans: string[] // union of all insurance_plans arrays across all offers, sorted alphabetically
}
