/**
 * Ranker module.
 *
 * Final step of the ranking pipeline:
 *   1. Sort deduplicated scored offers by value_score desc, effective_price asc
 *   2. Assign sequential rank starting at 1
 *   3. Generate reason_code (structured) and reason (human-readable)
 *
 * reason_code reflects which factor most contributed to the offer's rank.
 * reason provides a patient-friendly explanation including key metrics.
 */

import type { ScoredOffer, RankedOffer, ReasonCode } from '../types'

// ---------------------------------------------------------------------------
// Reason generation
// ---------------------------------------------------------------------------

/**
 * Determines the dominant factor that elevated this offer's value_score,
 * returning a structured code and a human-readable sentence.
 *
 * Weighted contributions to value_score:
 *   quality_score * 0.5   → up to 50 pts
 *   wait_score * 25       → up to 25 pts
 *   distance_score * 15   → up to 15 pts
 *   effective_price / 2000 → cost penalty
 *
 * We compare the actual point contributions to determine dominance.
 */
export function buildReason(offer: ScoredOffer): { reason_code: ReasonCode; reason: string } {
  const qualityContrib = offer.quality_score * 0.5
  const waitContrib = offer.wait_score * 25
  const distContrib = offer.distance_score * 15
  // Price is a penalty — lower contribution means lower price → better
  const pricePenalty = offer.effective_price / 2000

  const discountNote = offer.insurance_applied ? ', insurance discount applied' : ''

  // Find dominant positive factor
  const contributions = [
    { code: 'BEST_QUALITY' as ReasonCode, value: qualityContrib },
    { code: 'SHORTEST_WAIT' as ReasonCode, value: waitContrib },
    { code: 'CLOSEST_DISTANCE' as ReasonCode, value: distContrib },
  ]

  const dominant = contributions.reduce((best, curr) => (curr.value > best.value ? curr : best))

  // If price penalty is very low relative to contributions, surface price as the driver
  const totalPositive = qualityContrib + waitContrib + distContrib
  const isPriceDominant = pricePenalty < totalPositive * 0.1 && offer.effective_price < 50000

  if (isPriceDominant) {
    return {
      reason_code: 'BEST_PRICE',
      reason: `Best price: ${offer.effective_price.toFixed(0)} ${offer.currency}` +
        ` with quality ${offer.quality_score}${discountNote}`,
    }
  }

  // Check if the overall value_score is exceptionally balanced across factors
  const maxContrib = Math.max(qualityContrib, waitContrib, distContrib)
  const minContrib = Math.min(qualityContrib, waitContrib, distContrib)
  const isBalanced = maxContrib > 0 && (maxContrib - minContrib) / maxContrib < 0.4

  if (isBalanced && offer.value_score > 40) {
    return {
      reason_code: 'TOP_VALUE_SCORE',
      reason: `Best overall value: quality ${offer.quality_score}` +
        `, wait ${offer.wait_hours} h` +
        `, distance ${offer.distance_km} km` +
        discountNote,
    }
  }

  switch (dominant.code) {
    case 'BEST_QUALITY':
      return {
        reason_code: 'BEST_QUALITY',
        reason: `High quality score: ${offer.quality_score}` +
          ` with wait ${offer.wait_hours} h and distance ${offer.distance_km} km` +
          discountNote,
      }
    case 'SHORTEST_WAIT':
      return {
        reason_code: 'SHORTEST_WAIT',
        reason: `Shortest wait time: ${offer.wait_hours} h` +
          ` with quality ${offer.quality_score}` +
          discountNote,
      }
    case 'CLOSEST_DISTANCE':
      return {
        reason_code: 'CLOSEST_DISTANCE',
        reason: `Closest location: ${offer.distance_km} km` +
          ` with quality ${offer.quality_score}` +
          discountNote,
      }
    default:
      return {
        reason_code: 'TOP_VALUE_SCORE',
        reason: `Strong overall value: quality ${offer.quality_score}` +
          `, wait ${offer.wait_hours} h` +
          discountNote,
      }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sorts deduplicated scored offers and assigns sequential rank.
 *
 * Sort order:
 *   Primary:   value_score descending (higher is better)
 *   Secondary: effective_price ascending (lower is better on tie)
 *
 * @param dedupedOffers - Scored + deduplicated offers
 * @returns Ranked offers with rank, reason_code, and reason assigned
 */
export function rankOffers(dedupedOffers: ScoredOffer[]): RankedOffer[] {
  if (dedupedOffers.length === 0) return []

  const sorted = [...dedupedOffers].sort((a, b) => {
    if (b.value_score !== a.value_score) {
      return b.value_score - a.value_score        // desc
    }
    return a.effective_price - b.effective_price  // asc on tie
  })

  return sorted.map((offer, index) => {
    const { reason_code, reason } = buildReason(offer)
    return {
      rank: index + 1,
      offer_id: offer.offer_id,
      provider_id: offer.provider_id,
      effective_price: Math.round(offer.effective_price * 100) / 100,
      wait_hours: offer.wait_hours,
      distance_km: offer.distance_km,
      quality_score: offer.quality_score,
      value_score: Math.round(offer.value_score * 1000) / 1000, // 3dp
      reason_code,
      reason,
    }
  })
}
