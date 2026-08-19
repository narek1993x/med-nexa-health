/**
 * Unit tests for the deduplication module.
 */

import { describe, it, expect } from 'vitest'
import { deduplicateBySlot } from '../../src/ranking/service/deduplicator'
import type { ScoredOffer } from '../../src/ranking/types'

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeScoredOffer(overrides: Partial<ScoredOffer> = {}): ScoredOffer {
  return {
    offer_id: 'TEST-001',
    provider_id: 'provider-a',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 90000,
    earliest_slot_utc: '2026-09-02T09:00:00Z',
    wait_hours: 20,
    distance_km: 5.0,
    quality_score: 85,
    insurance_plans: ['MedPrime'],
    converted_price: 90000,
    effective_price: 76500,
    wait_score: 0.72,
    distance_score: 0.67,
    value_score: 50.0,
    insurance_applied: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// No deduplication needed
// ---------------------------------------------------------------------------

describe('deduplicateBySlot: no duplicates', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateBySlot([])).toHaveLength(0)
  })

  it('returns single offer unchanged', () => {
    const offer = makeScoredOffer()
    const result = deduplicateBySlot([offer])
    expect(result).toHaveLength(1)
    expect(result[0].offer_id).toBe('TEST-001')
  })

  it('preserves all offers when slots are unique', () => {
    const a = makeScoredOffer({ offer_id: 'A', earliest_slot_utc: '2026-09-02T09:00:00Z' })
    const b = makeScoredOffer({ offer_id: 'B', earliest_slot_utc: '2026-09-02T10:30:00Z' })
    const c = makeScoredOffer({ offer_id: 'C', earliest_slot_utc: '2026-09-03T08:00:00Z' })
    const result = deduplicateBySlot([a, b, c])
    expect(result).toHaveLength(3)
  })

  it('preserves offers from different cities for the same slot time', () => {
    const yerevan = makeScoredOffer({ offer_id: 'Y', city: 'Yerevan' })
    const vanadzor = makeScoredOffer({ offer_id: 'V', city: 'Vanadzor' })
    const result = deduplicateBySlot([yerevan, vanadzor])
    expect(result).toHaveLength(2)
  })

  it('preserves offers with different service_codes for the same slot time', () => {
    const mri = makeScoredOffer({ offer_id: 'M', service_code: 'MRI_BRAIN' })
    const ct = makeScoredOffer({ offer_id: 'C', service_code: 'CT_SCAN' })
    const result = deduplicateBySlot([mri, ct])
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Deduplication — highest value_score wins
// ---------------------------------------------------------------------------

describe('deduplicateBySlot: keeps highest value_score per slot', () => {
  it('keeps the offer with the higher value_score', () => {
    const better = makeScoredOffer({ offer_id: 'BETTER', value_score: 60, provider_id: 'northcare' })
    const worse = makeScoredOffer({ offer_id: 'WORSE', value_score: 45, provider_id: 'carepoint' })
    const result = deduplicateBySlot([worse, better])
    expect(result).toHaveLength(1)
    expect(result[0].offer_id).toBe('BETTER')
  })

  it('order of input does not affect winner (lower score listed first)', () => {
    const low = makeScoredOffer({ offer_id: 'LOW', value_score: 30 })
    const high = makeScoredOffer({ offer_id: 'HIGH', value_score: 70 })
    const result = deduplicateBySlot([low, high])
    expect(result[0].offer_id).toBe('HIGH')
  })

  it('three providers same slot — only the best value_score survives', () => {
    const a = makeScoredOffer({ offer_id: 'A', value_score: 40 })
    const b = makeScoredOffer({ offer_id: 'B', value_score: 70 })
    const c = makeScoredOffer({ offer_id: 'C', value_score: 55 })
    const result = deduplicateBySlot([a, b, c])
    expect(result).toHaveLength(1)
    expect(result[0].offer_id).toBe('B')
  })
})

// ---------------------------------------------------------------------------
// Tie-breaking — lowest effective_price wins
// ---------------------------------------------------------------------------

describe('deduplicateBySlot: tie-breaking by effective_price', () => {
  it('keeps lower effective_price when value_score is equal', () => {
    const expensive = makeScoredOffer({
      offer_id: 'EXPENSIVE',
      value_score: 50,
      effective_price: 90000,
    })
    const cheap = makeScoredOffer({
      offer_id: 'CHEAP',
      value_score: 50,
      effective_price: 77000,
    })
    const result = deduplicateBySlot([expensive, cheap])
    expect(result).toHaveLength(1)
    expect(result[0].offer_id).toBe('CHEAP')
  })

  it('tie-break does not apply when value_scores differ', () => {
    // Higher value_score always wins regardless of price
    const highScoreCostly = makeScoredOffer({
      offer_id: 'HVC',
      value_score: 70,
      effective_price: 95000,
    })
    const lowScoreCheap = makeScoredOffer({
      offer_id: 'LSC',
      value_score: 40,
      effective_price: 50000,
    })
    const result = deduplicateBySlot([highScoreCostly, lowScoreCheap])
    expect(result[0].offer_id).toBe('HVC')
  })
})

// ---------------------------------------------------------------------------
// Mixed scenarios — multiple slots with some duplicates
// ---------------------------------------------------------------------------

describe('deduplicateBySlot: mixed scenarios', () => {
  it('deduplicates one slot while preserving a distinct slot', () => {
    const slot1a = makeScoredOffer({
      offer_id: 'S1A',
      earliest_slot_utc: '2026-09-02T09:00:00Z',
      value_score: 60,
    })
    const slot1b = makeScoredOffer({
      offer_id: 'S1B',
      earliest_slot_utc: '2026-09-02T09:00:00Z',
      value_score: 45,
    })
    const slot2 = makeScoredOffer({
      offer_id: 'S2',
      earliest_slot_utc: '2026-09-02T14:00:00Z',
      value_score: 55,
    })

    const result = deduplicateBySlot([slot1a, slot1b, slot2])
    expect(result).toHaveLength(2)
    const ids = result.map((o) => o.offer_id)
    expect(ids).toContain('S1A')
    expect(ids).toContain('S2')
    expect(ids).not.toContain('S1B')
  })

  it('slot key comparison is case-insensitive for city and service_code', () => {
    const a = makeScoredOffer({ offer_id: 'A', city: 'Yerevan', service_code: 'MRI_BRAIN', value_score: 50 })
    const b = makeScoredOffer({ offer_id: 'B', city: 'yerevan', service_code: 'mri_brain', value_score: 70 })
    const result = deduplicateBySlot([a, b])
    expect(result).toHaveLength(1)
    expect(result[0].offer_id).toBe('B')
  })
})
