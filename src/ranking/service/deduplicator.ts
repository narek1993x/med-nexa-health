/**
 * Deduplication module.
 *
 * Implements slot-level deduplication: when multiple providers list the same
 * appointment slot (identified by service_code + city + earliest_slot_utc),
 * only the offer with the highest value_score is kept.
 *
 * Tie-breaking: if two offers share the same slot and value_score, the one
 * with the lower effective_price wins (best price for the patient).
 *
 * This directly implements:
 *   "when the same medical service appears from multiple sources at
 *    different prices, always show the best customer option"
 *
 * Deduplication runs AFTER scoring so the winner is always determined by
 * the same metric used for ranking — consistent, predictable behavior.
 */

import type { ScoredOffer } from '../types'

/**
 * Returns the composite slot key used for grouping.
 * Normalised to lowercase to prevent case-sensitivity mismatches.
 */
function slotKey(offer: ScoredOffer): string {
  return [
    offer.service_code.trim().toLowerCase(),
    offer.city.trim().toLowerCase(),
    offer.earliest_slot_utc.trim(),
  ].join('|')
}

/**
 * Deduplicates scored offers by slot, keeping the best offer per slot.
 *
 * @param scoredOffers - Array of offers that have already been scored
 * @returns Deduplicated array — one offer per unique slot
 */
export function deduplicateBySlot(scoredOffers: ScoredOffer[]): ScoredOffer[] {
  if (scoredOffers.length === 0) return []

  const slotMap = new Map<string, ScoredOffer>()

  for (const offer of scoredOffers) {
    const key = slotKey(offer)
    const existing = slotMap.get(key)

    if (!existing) {
      slotMap.set(key, offer)
      continue
    }

    // Keep the offer with the higher value_score
    if (offer.value_score > existing.value_score) {
      slotMap.set(key, offer)
      continue
    }

    // Tie in value_score — keep the lower effective_price (better for patient)
    if (offer.value_score === existing.value_score && offer.effective_price < existing.effective_price) {
      slotMap.set(key, offer)
    }
  }

  return Array.from(slotMap.values())
}
