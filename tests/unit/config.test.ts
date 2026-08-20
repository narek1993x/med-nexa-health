/**
 * Unit tests for the config derivation module.
 *
 * Tests the pure `deriveConfigOptions` function across:
 *   - empty input
 *   - single offer
 *   - deduplication for each field
 *   - insurance_plans flattening and deduplication
 *   - alphabetical sort order for all four arrays
 *   - full spec mock data (northcare + carepoint combined)
 */

import { describe, it, expect } from 'vitest'
import { deriveConfigOptions } from '../../src/ranking/service/config'
import type { Offer } from '../../src/ranking/types'
import { NORTHCARE_OFFERS } from '../../src/mocks/northcare'
import { CAREPOINT_OFFERS } from '../../src/mocks/carepoint'

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

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe('deriveConfigOptions: empty input', () => {
  it('returns all empty arrays for empty offer list', () => {
    const result = deriveConfigOptions([])
    expect(result.service_codes).toHaveLength(0)
    expect(result.cities).toHaveLength(0)
    expect(result.currencies).toHaveLength(0)
    expect(result.insurance_plans).toHaveLength(0)
  })

  it('returns the correct shape with empty arrays', () => {
    const result = deriveConfigOptions([])
    expect(result).toHaveProperty('service_codes')
    expect(result).toHaveProperty('cities')
    expect(result).toHaveProperty('currencies')
    expect(result).toHaveProperty('insurance_plans')
    expect(Array.isArray(result.service_codes)).toBe(true)
    expect(Array.isArray(result.cities)).toBe(true)
    expect(Array.isArray(result.currencies)).toBe(true)
    expect(Array.isArray(result.insurance_plans)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Single offer
// ---------------------------------------------------------------------------

describe('deriveConfigOptions: single offer', () => {
  it('extracts all values from a single offer', () => {
    const offer = makeOffer({
      service_code: 'CT_CHEST',
      city: 'Gyumri',
      currency: 'USD',
      insurance_plans: ['CarePlus', 'SilverShield'],
    })

    const result = deriveConfigOptions([offer])
    expect(result.service_codes).toEqual(['CT_CHEST'])
    expect(result.cities).toEqual(['Gyumri'])
    expect(result.currencies).toEqual(['USD'])
    expect(result.insurance_plans).toEqual(['CarePlus', 'SilverShield'])
  })

  it('handles an offer with no insurance plans', () => {
    const offer = makeOffer({ insurance_plans: [] })
    const result = deriveConfigOptions([offer])
    expect(result.insurance_plans).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe('deriveConfigOptions: deduplication', () => {
  it('deduplicates service_codes across offers', () => {
    const offers = [
      makeOffer({ offer_id: 'A', service_code: 'MRI_BRAIN' }),
      makeOffer({ offer_id: 'B', service_code: 'MRI_BRAIN' }),
      makeOffer({ offer_id: 'C', service_code: 'CT_CHEST' }),
    ]
    const result = deriveConfigOptions(offers)
    expect(result.service_codes).toHaveLength(2)
    expect(result.service_codes).toEqual(['CT_CHEST', 'MRI_BRAIN'])
  })

  it('deduplicates cities across offers', () => {
    const offers = [
      makeOffer({ offer_id: 'A', city: 'Yerevan' }),
      makeOffer({ offer_id: 'B', city: 'Yerevan' }),
      makeOffer({ offer_id: 'C', city: 'Gyumri' }),
    ]
    const result = deriveConfigOptions(offers)
    expect(result.cities).toHaveLength(2)
    expect(result.cities).toEqual(['Gyumri', 'Yerevan'])
  })

  it('deduplicates currencies across offers', () => {
    const offers = [
      makeOffer({ offer_id: 'A', currency: 'AMD' }),
      makeOffer({ offer_id: 'B', currency: 'AMD' }),
      makeOffer({ offer_id: 'C', currency: 'USD' }),
    ]
    const result = deriveConfigOptions(offers)
    expect(result.currencies).toHaveLength(2)
    expect(result.currencies).toEqual(['AMD', 'USD'])
  })

  it('deduplicates insurance_plans across different offers', () => {
    const offers = [
      makeOffer({ offer_id: 'A', insurance_plans: ['MedPrime', 'SilverShield'] }),
      makeOffer({ offer_id: 'B', insurance_plans: ['MedPrime', 'CarePlus'] }),
    ]
    const result = deriveConfigOptions(offers)
    expect(result.insurance_plans).toHaveLength(3)
    expect(result.insurance_plans).toEqual(['CarePlus', 'MedPrime', 'SilverShield'])
  })

  it('flattens insurance_plans from multiple offers into a single union set', () => {
    const offers = [
      makeOffer({ offer_id: 'A', insurance_plans: ['MedPrime'] }),
      makeOffer({ offer_id: 'B', insurance_plans: ['SilverShield'] }),
      makeOffer({ offer_id: 'C', insurance_plans: ['CarePlus'] }),
    ]
    const result = deriveConfigOptions(offers)
    expect(result.insurance_plans).toHaveLength(3)
    expect(result.insurance_plans).toContain('MedPrime')
    expect(result.insurance_plans).toContain('SilverShield')
    expect(result.insurance_plans).toContain('CarePlus')
  })
})

// ---------------------------------------------------------------------------
// Alphabetical sort order
// ---------------------------------------------------------------------------

describe('deriveConfigOptions: alphabetical sort', () => {
  it('sorts service_codes alphabetically', () => {
    const offers = [
      makeOffer({ offer_id: 'A', service_code: 'MRI_BRAIN' }),
      makeOffer({ offer_id: 'B', service_code: 'CT_CHEST' }),
      makeOffer({ offer_id: 'C', service_code: 'ULTRASOUND' }),
    ]
    const result = deriveConfigOptions(offers)
    expect(result.service_codes).toEqual(['CT_CHEST', 'MRI_BRAIN', 'ULTRASOUND'])
  })

  it('sorts cities alphabetically', () => {
    const offers = [
      makeOffer({ offer_id: 'A', city: 'Yerevan' }),
      makeOffer({ offer_id: 'B', city: 'Gyumri' }),
      makeOffer({ offer_id: 'C', city: 'Vanadzor' }),
    ]
    const result = deriveConfigOptions(offers)
    expect(result.cities).toEqual(['Gyumri', 'Vanadzor', 'Yerevan'])
  })

  it('sorts currencies alphabetically', () => {
    const offers = [
      makeOffer({ offer_id: 'A', currency: 'USD' }),
      makeOffer({ offer_id: 'B', currency: 'AMD' }),
      makeOffer({ offer_id: 'C', currency: 'EUR' }),
    ]
    const result = deriveConfigOptions(offers)
    expect(result.currencies).toEqual(['AMD', 'EUR', 'USD'])
  })

  it('sorts insurance_plans alphabetically', () => {
    const offers = [makeOffer({ insurance_plans: ['SilverShield', 'CarePlus', 'MedPrime'] })]
    const result = deriveConfigOptions(offers)
    expect(result.insurance_plans).toEqual(['CarePlus', 'MedPrime', 'SilverShield'])
  })
})

// ---------------------------------------------------------------------------
// Full spec mock data — exact expected output
// ---------------------------------------------------------------------------

describe('deriveConfigOptions: full spec mock data', () => {
  const allOffers = [...NORTHCARE_OFFERS, ...CAREPOINT_OFFERS]

  it('produces exact expected service_codes from spec mock data', () => {
    const result = deriveConfigOptions(allOffers)
    expect(result.service_codes).toEqual(['CT_CHEST', 'MRI_BRAIN'])
  })

  it('produces exact expected cities from spec mock data', () => {
    const result = deriveConfigOptions(allOffers)
    expect(result.cities).toEqual(['Gyumri', 'Vanadzor', 'Yerevan'])
  })

  it('produces exact expected currencies from spec mock data', () => {
    const result = deriveConfigOptions(allOffers)
    expect(result.currencies).toEqual(['AMD', 'EUR', 'USD'])
  })

  it('produces exact expected insurance_plans from spec mock data', () => {
    const result = deriveConfigOptions(allOffers)
    expect(result.insurance_plans).toEqual(['CarePlus', 'MedPrime', 'SilverShield'])
  })

  it('has no duplicates in any array', () => {
    const result = deriveConfigOptions(allOffers)
    const toUnique = (arr: string[]): string[] => [...new Set(arr)]
    expect(result.service_codes).toEqual(toUnique(result.service_codes))
    expect(result.cities).toEqual(toUnique(result.cities))
    expect(result.currencies).toEqual(toUnique(result.currencies))
    expect(result.insurance_plans).toEqual(toUnique(result.insurance_plans))
  })
})
