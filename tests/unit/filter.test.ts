/**
 * Unit tests for the filter module.
 */

import { describe, it, expect } from 'vitest'
import { filterByServiceAndCity, filterByConstraints } from '../../src/ranking/service/filter'
import type { Offer } from '../../src/ranking/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    offer_id: 'TEST-001',
    provider_id: 'testprovider',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 90000,
    earliest_slot_utc: '2026-09-02T09:00:00Z',
    wait_hours: 20,
    distance_km: 5.0,
    quality_score: 85,
    insurance_plans: ['MedPrime'],
    ...overrides,
  }
}

const YEREVAN_MRI = makeOffer({ offer_id: 'Y1', city: 'Yerevan', service_code: 'MRI_BRAIN' })
const YEREVAN_CT = makeOffer({ offer_id: 'Y2', city: 'Yerevan', service_code: 'CT_SCAN' })
const VANADZOR_MRI = makeOffer({ offer_id: 'V1', city: 'Vanadzor', service_code: 'MRI_BRAIN' })
const TBILISI_MRI = makeOffer({ offer_id: 'T1', city: 'Tbilisi', service_code: 'MRI_BRAIN' })

// ---------------------------------------------------------------------------
// filterByServiceAndCity
// ---------------------------------------------------------------------------

describe('filterByServiceAndCity', () => {
  it('returns matching offers for correct service_code and city', () => {
    const result = filterByServiceAndCity(
      [YEREVAN_MRI, YEREVAN_CT, VANADZOR_MRI],
      'MRI_BRAIN',
      'Yerevan',
    )
    expect(result).toHaveLength(1)
    expect(result[0].offer_id).toBe('Y1')
  })

  it('returns empty array when no offers match', () => {
    const result = filterByServiceAndCity([YEREVAN_MRI], 'ULTRASOUND', 'Yerevan')
    expect(result).toHaveLength(0)
  })

  it('is case-insensitive for service_code', () => {
    const result = filterByServiceAndCity([YEREVAN_MRI], 'mri_brain', 'Yerevan')
    expect(result).toHaveLength(1)
  })

  it('is case-insensitive for city', () => {
    const result = filterByServiceAndCity([YEREVAN_MRI], 'MRI_BRAIN', 'yerevan')
    expect(result).toHaveLength(1)
  })

  it('returns multiple matches when both providers serve same city/service', () => {
    const offer2 = makeOffer({ offer_id: 'Y3', city: 'Yerevan', service_code: 'MRI_BRAIN' })
    const result = filterByServiceAndCity([YEREVAN_MRI, offer2], 'MRI_BRAIN', 'Yerevan')
    expect(result).toHaveLength(2)
  })

  it('excludes offers from other cities', () => {
    const result = filterByServiceAndCity(
      [YEREVAN_MRI, VANADZOR_MRI, TBILISI_MRI],
      'MRI_BRAIN',
      'Yerevan',
    )
    expect(result).toHaveLength(1)
    expect(result[0].city).toBe('Yerevan')
  })

  it('returns empty array for empty input', () => {
    const result = filterByServiceAndCity([], 'MRI_BRAIN', 'Yerevan')
    expect(result).toHaveLength(0)
  })

  it('handles whitespace in service_code and city', () => {
    const result = filterByServiceAndCity([YEREVAN_MRI], '  MRI_BRAIN  ', '  Yerevan  ')
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// filterByConstraints
// ---------------------------------------------------------------------------

describe('filterByConstraints', () => {
  it('removes offers exceeding max_distance_km', () => {
    const close = makeOffer({ offer_id: 'C1', distance_km: 5 })
    const far = makeOffer({ offer_id: 'F1', distance_km: 20 })
    const result = filterByConstraints([close, far], 15, 72)
    expect(result).toHaveLength(1)
    expect(result[0].offer_id).toBe('C1')
  })

  it('removes offers exceeding max_wait_hours', () => {
    const fast = makeOffer({ offer_id: 'W1', wait_hours: 20 })
    const slow = makeOffer({ offer_id: 'W2', wait_hours: 80 })
    const result = filterByConstraints([fast, slow], 15, 72)
    expect(result).toHaveLength(1)
    expect(result[0].offer_id).toBe('W1')
  })

  it('includes offer at exactly max_distance_km (inclusive bound)', () => {
    const exact = makeOffer({ offer_id: 'E1', distance_km: 15 })
    const result = filterByConstraints([exact], 15, 72)
    expect(result).toHaveLength(1)
  })

  it('includes offer at exactly max_wait_hours (inclusive bound)', () => {
    const exact = makeOffer({ offer_id: 'E2', wait_hours: 72 })
    const result = filterByConstraints([exact], 15, 72)
    expect(result).toHaveLength(1)
  })

  it('excludes offer 1 km over max_distance', () => {
    const over = makeOffer({ distance_km: 16 })
    const result = filterByConstraints([over], 15, 72)
    expect(result).toHaveLength(0)
  })

  it('excludes offer 1 hour over max_wait', () => {
    const over = makeOffer({ wait_hours: 73 })
    const result = filterByConstraints([over], 15, 72)
    expect(result).toHaveLength(0)
  })

  it('returns all offers when all pass both constraints', () => {
    const offers = [
      makeOffer({ offer_id: 'A', distance_km: 1, wait_hours: 5 }),
      makeOffer({ offer_id: 'B', distance_km: 10, wait_hours: 50 }),
    ]
    const result = filterByConstraints(offers, 15, 72)
    expect(result).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(filterByConstraints([], 15, 72)).toHaveLength(0)
  })

  it('CP-2005 (Vanadzor, wait_hours=60) passes when max_wait_hours=72', () => {
    const cp2005 = makeOffer({ offer_id: 'CP-2005', wait_hours: 60, distance_km: 3.5 })
    const result = filterByConstraints([cp2005], 15, 72)
    expect(result).toHaveLength(1)
  })
})
