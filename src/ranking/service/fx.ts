/**
 * FX conversion module.
 *
 * Provides pure functions for currency conversion using a static in-memory
 * rate table. The table is loaded once at Lambda cold start from the FX_RATES
 * environment variable and never mutated.
 *
 * Default rates (AMD ↔ USD) are embedded as a fallback for local development.
 * In production, override via the FX_RATES environment variable.
 */

import type { FxTable } from '../types'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FxConversionError extends Error {
  constructor(from: string, to: string) {
    // Safe message — currency codes are not sensitive; no internal paths exposed
    super(`No FX rate available for ${from} → ${to}`)
    this.name = 'FxConversionError'
  }
}

// ---------------------------------------------------------------------------
// Default FX table (local dev fallback)
// Rates approximate as of mid-2026 — replace via FX_RATES env var in production
// ---------------------------------------------------------------------------

const DEFAULT_FX_TABLE: FxTable = {
  AMD: { AMD: 1, USD: 0.00261, EUR: 0.00238 },
  USD: { USD: 1, AMD: 383.14, EUR: 0.912 },
  EUR: { EUR: 1, AMD: 420.0, USD: 1.0965 },
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads the FX rate table from the FX_RATES environment variable.
 * Falls back to the default table if the variable is unset or empty.
 *
 * @param env - Raw value of process.env.FX_RATES
 * @throws Error if the env var is set but contains invalid JSON
 * @returns FxTable — nested map of { FROM: { TO: rate } }
 */
export function loadFxTable(env: string | undefined): FxTable {
  if (!env || env.trim().length === 0) {
    return DEFAULT_FX_TABLE
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(env)
  } catch {
    throw new Error('FX_RATES environment variable is not valid JSON')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('FX_RATES must be a JSON object mapping currency codes to rate maps')
  }

  return parsed as FxTable
}

/**
 * Converts an amount from one currency to another using the given FX table.
 *
 * Same-currency conversion returns the input unchanged (no floating-point drift).
 * Result is rounded to 2 decimal places.
 *
 * @param amount - The amount to convert (must be >= 0)
 * @param from   - ISO 4217 source currency code (e.g. "AMD")
 * @param to     - ISO 4217 target currency code (e.g. "USD")
 * @param table  - FX rate table loaded via loadFxTable()
 * @throws FxConversionError if the currency pair is not in the table
 * @throws Error if amount is negative
 */
export function convertPrice(amount: number, from: string, to: string, table: FxTable): number {
  if (amount < 0) {
    throw new Error('Amount must be non-negative')
  }

  // Same-currency — return exact input, no arithmetic
  if (from === to) {
    return amount
  }

  const fromRates = table[from]
  if (!fromRates) {
    throw new FxConversionError(from, to)
  }

  const rate = fromRates[to]
  if (rate === undefined) {
    throw new FxConversionError(from, to)
  }

  // Round to 2 decimal places to avoid floating-point accumulation
  return Math.round(amount * rate * 100) / 100
}
