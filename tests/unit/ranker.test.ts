/**
 * Unit tests for the ranker module.
 *
 * Key verification: manually computed value_scores from spec sample data
 * are used to confirm the rank order is deterministic and correct.
 *
 * Manual calculations (patient_currency=AMD, max_distance=15, max_wait=72, insurance=MedPrime):
 *
 * NC-1001 (AMD, 95000): converted=95000, effective=80750 (MedPrime match)
 *   wait_score  = 1 - 20/72  = 0.72222
 *   dist_score  = 1 - 3.2/15 = 0.78667
 *   value_score = 88*0.5 + 0.72222*25 + 0.78667*15 - 80750/2000
 *               = 44 + 18.056 + 11.800 - 40.375 = 33.481
 *
 * CP-2001 (AMD, 91000): converted=91000, effective=77350 (MedPrime match)
 *   wait_score  = 1 - 22/72  = 0.69444
 *   dist_score  = 1 - 4.0/15 = 0.73333
 *   value_score = 86*0.5 + 0.69444*25 + 0.73333*15 - 77350/2000
 *               = 43 + 17.361 + 11.000 - 38.675 = 32.686
 *
 * NC-1005 (USD→AMD: 230*383.14=88122.2): no insurance, effective=88122.2
 *   wait_score  = 1 - 28/72  = 0.61111
 *   dist_score  = 1 - 11.9/15 = 0.20667
 *   value_score = 90*0.5 + 0.61111*25 + 0.20667*15 - 88122.2/2000
 *               = 45 + 15.278 + 3.100 - 44.061 = 19.317
 *
 * Expected rank: NC-1001 (1st) > CP-2001 (2nd) > NC-1005 (3rd)
 */

import { describe, it, expect } from 'vitest'
import { rankOffers, buildReason } from '../../src/ranking/service/ranker'
import type { ScoredOffer } from '../../src/ranking/types'

// ---------------------------------------------------------------------------
// Spec-derived scored offer fixtures
// ---------------------------------------------------------------------------

const NC1001: ScoredOffer = {
  offer_id: 'NC-1001',
  provider_id: 'northcare',
  service_code: 'MRI_BRAIN',
  city: 'Yerevan',
  currency: 'AMD',
  price_amount: 95000,
  earliest_slot_utc: '2026-09-02T09:00:00Z',
  wait_hours: 20,
  distance_km: 3.2,
  quality_score: 88,
  insurance_plans: ['MedPrime', 'SilverShield'],
  converted_price: 95000,
  effective_price: 80750,
  wait_score: 1 - 20 / 72,
  distance_score: 1 - 3.2 / 15,
  value_score: 88 * 0.5 + (1 - 20 / 72) * 25 + (1 - 3.2 / 15) * 15 - 80750 / 2000,
  insurance_applied: true,
}

const CP2001: ScoredOffer = {
  offer_id: 'CP-2001',
  provider_id: 'carepoint',
  service_code: 'MRI_BRAIN',
  city: 'Yerevan',
  currency: 'AMD',
  price_amount: 91000,
  earliest_slot_utc: '2026-09-02T10:30:00Z',
  wait_hours: 22,
  distance_km: 4.0,
  quality_score: 86,
  insurance_plans: ['MedPrime', 'CarePlus'],
  converted_price: 91000,
  effective_price: 77350,
  wait_score: 1 - 22 / 72,
  distance_score: 1 - 4.0 / 15,
  value_score: 86 * 0.5 + (1 - 22 / 72) * 25 + (1 - 4.0 / 15) * 15 - 77350 / 2000,
  insurance_applied: true,
}

const NC1005: ScoredOffer = {
  offer_id: 'NC-1005',
  provider_id: 'northcare',
  service_code: 'MRI_BRAIN',
  city: 'Yerevan',
  currency: 'USD',
  price_amount: 230,
  earliest_slot_utc: '2026-09-02T18:15:00Z',
  wait_hours: 28,
  distance_km: 11.9,
  quality_score: 90,
  insurance_plans: [],
  converted_price: 88122.2,
  effective_price: 88122.2,
  wait_score: 1 - 28 / 72,
  distance_score: 1 - 11.9 / 15,
  value_score: 90 * 0.5 + (1 - 28 / 72) * 25 + (1 - 11.9 / 15) * 15 - 88122.2 / 2000,
  insurance_applied: false,
}

// ---------------------------------------------------------------------------
// rankOffers — sort order
// ---------------------------------------------------------------------------

describe('rankOffers: sort order', () => {
  it('returns empty array for empty input', () => {
    expect(rankOffers([], 'AMD')).toHaveLength(0)
  })

  it('returns single offer with rank 1', () => {
    const result = rankOffers([NC1001], 'AMD')
    expect(result).toHaveLength(1)
    expect(result[0].rank).toBe(1)
  })

  it('spec sample data: NC-1001 ranks 1st', () => {
    const result = rankOffers([NC1005, CP2001, NC1001], 'AMD')
    expect(result[0].offer_id).toBe('NC-1001')
    expect(result[0].rank).toBe(1)
  })

  it('spec sample data: CP-2001 ranks 2nd', () => {
    const result = rankOffers([NC1005, CP2001, NC1001], 'AMD')
    expect(result[1].offer_id).toBe('CP-2001')
    expect(result[1].rank).toBe(2)
  })

  it('spec sample data: NC-1005 ranks 3rd (last)', () => {
    const result = rankOffers([NC1005, CP2001, NC1001], 'AMD')
    expect(result[2].offer_id).toBe('NC-1005')
    expect(result[2].rank).toBe(3)
  })

  it('rank is always sequential starting at 1', () => {
    const result = rankOffers([NC1005, CP2001, NC1001], 'AMD')
    result.forEach((r, i) => expect(r.rank).toBe(i + 1))
  })

  it('input order does not affect output rank (deterministic)', () => {
    const order1 = rankOffers([NC1001, CP2001, NC1005], 'AMD')
    const order2 = rankOffers([NC1005, NC1001, CP2001], 'AMD')
    expect(order1.map((r) => r.offer_id)).toEqual(order2.map((r) => r.offer_id))
  })

  it('tie-break by effective_price ascending', () => {
    const expensive = { ...NC1001, offer_id: 'EXP', effective_price: 90000 }
    const cheap = { ...NC1001, offer_id: 'CHE', effective_price: 70000 }
    // Same value_score — cheaper wins
    expensive.value_score = NC1001.value_score
    cheap.value_score = NC1001.value_score
    const result = rankOffers([expensive, cheap], 'AMD')
    expect(result[0].offer_id).toBe('CHE')
  })
})

// ---------------------------------------------------------------------------
// rankOffers — output shape
// ---------------------------------------------------------------------------

describe('rankOffers: output shape', () => {
  it('output includes all required fields', () => {
    const result = rankOffers([NC1001], 'AMD')
    const offer = result[0]
    expect(offer).toHaveProperty('rank')
    expect(offer).toHaveProperty('offer_id')
    expect(offer).toHaveProperty('provider_id')
    expect(offer).toHaveProperty('effective_price')
    expect(offer).toHaveProperty('wait_hours')
    expect(offer).toHaveProperty('distance_km')
    expect(offer).toHaveProperty('quality_score')
    expect(offer).toHaveProperty('value_score')
    expect(offer).toHaveProperty('reason_code')
    expect(offer).toHaveProperty('reason')
  })

  it('value_score is rounded to 3 decimal places', () => {
    const result = rankOffers([NC1001], 'AMD')
    const decimals = result[0].value_score.toString().split('.')[1]?.length ?? 0
    expect(decimals).toBeLessThanOrEqual(3)
  })

  it('effective_price is rounded to 2 decimal places', () => {
    const result = rankOffers([NC1001], 'AMD')
    const decimals = result[0].effective_price.toString().split('.')[1]?.length ?? 0
    expect(decimals).toBeLessThanOrEqual(2)
  })

  it('does not mutate the input array', () => {
    const input = [NC1005, NC1001, CP2001]
    const originalOrder = input.map((o) => o.offer_id)
    rankOffers(input, 'AMD')
    expect(input.map((o) => o.offer_id)).toEqual(originalOrder)
  })
})

// ---------------------------------------------------------------------------
// buildReason — reason_code and reason string
// ---------------------------------------------------------------------------

describe('buildReason', () => {
  it('returns a reason_code from the allowed set', () => {
    const allowed = [
      'TOP_VALUE_SCORE',
      'BEST_PRICE',
      'BEST_QUALITY',
      'SHORTEST_WAIT',
      'CLOSEST_DISTANCE',
    ]
    ;[NC1001, CP2001, NC1005].forEach((offer) => {
      const { reason_code } = buildReason(offer, 'AMD')
      expect(allowed).toContain(reason_code)
    })
  })

  it('reason string is non-empty', () => {
    const offers = [NC1001, CP2001, NC1005]
    offers.forEach((offer) => {
      const { reason } = buildReason(offer, 'AMD')
      expect(reason.length).toBeGreaterThan(0)
    })
  })

  it('reason mentions insurance discount when applied', () => {
    const { reason } = buildReason(NC1001, 'AMD') // insurance_applied: true
    expect(reason).toContain('insurance')
  })

  it('reason does not mention insurance when not applied', () => {
    const { reason } = buildReason(NC1005, 'AMD') // insurance_applied: false
    expect(reason).not.toContain('insurance')
  })

  it('reason includes quality score', () => {
    const { reason } = buildReason(NC1001, 'AMD')
    expect(reason).toContain('88')
  })

  it('reason_code is a string', () => {
    const { reason_code } = buildReason(NC1001, 'AMD')
    expect(typeof reason_code).toBe('string')
  })

  it('returns BEST_PRICE when price is very low relative to contributions', () => {
    const cheapOffer: ScoredOffer = {
      ...NC1001,
      effective_price: 5000, // very low → isPriceDominant triggers
      converted_price: 5000,
      quality_score: 50,
      wait_score: 0.3,
      distance_score: 0.2,
      value_score: 30,
      insurance_applied: false,
    }
    const { reason_code } = buildReason(cheapOffer, 'AMD')
    expect(reason_code).toBe('BEST_PRICE')
  })

  it('BEST_PRICE reason includes effective_price and patient_currency', () => {
    const cheapOffer: ScoredOffer = {
      ...NC1001,
      effective_price: 5000,
      converted_price: 5000,
      quality_score: 50,
      wait_score: 0.3,
      distance_score: 0.2,
      value_score: 30,
      insurance_applied: false,
    }
    const { reason } = buildReason(cheapOffer, 'AMD')
    expect(reason).toContain('5000')
    expect(reason).toContain('AMD')
  })

  it('returns SHORTEST_WAIT when wait contribution dominates', () => {
    // wait_score=1.0 → waitContrib=25; quality=0 → qualityContrib=0; dist=0 → distContrib=0
    const waitOffer: ScoredOffer = {
      ...NC1001,
      quality_score: 0,
      wait_score: 1.0,
      distance_score: 0.0,
      effective_price: 200000, // high price prevents BEST_PRICE, prevents balance
      converted_price: 200000,
      value_score: 25 - 100, // wait dominates positive side
      insurance_applied: false,
    }
    const { reason_code } = buildReason(waitOffer, 'AMD')
    expect(reason_code).toBe('SHORTEST_WAIT')
  })

  it('returns CLOSEST_DISTANCE when distance contribution dominates', () => {
    // dist_score=1.0 → distContrib=15; quality=0; wait=0
    const distOffer: ScoredOffer = {
      ...NC1001,
      quality_score: 0,
      wait_score: 0.0,
      distance_score: 1.0,
      effective_price: 200000, // prevents BEST_PRICE, prevents balance
      converted_price: 200000,
      value_score: 15 - 100,
      insurance_applied: false,
    }
    const { reason_code } = buildReason(distOffer, 'AMD')
    expect(reason_code).toBe('CLOSEST_DISTANCE')
  })

  it('returns BEST_QUALITY when quality contribution dominates', () => {
    // quality=100 → qualityContrib=50; wait=0; dist=0
    const qualOffer: ScoredOffer = {
      ...NC1001,
      quality_score: 100,
      wait_score: 0.0,
      distance_score: 0.0,
      effective_price: 200000, // prevents BEST_PRICE, prevents balance
      converted_price: 200000,
      value_score: 50 - 100,
      insurance_applied: false,
    }
    const { reason_code } = buildReason(qualOffer, 'AMD')
    expect(reason_code).toBe('BEST_QUALITY')
  })
})
