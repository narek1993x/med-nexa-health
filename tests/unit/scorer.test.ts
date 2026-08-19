/**
 * Unit tests for the scorer module.
 * Covers effective price, wait/distance normalisation, value_score formula,
 * and boundary/edge cases derived from the spec sample data.
 */

import { describe, it, expect } from 'vitest'
import {
  computeEffectivePrice,
  computeWaitScore,
  computeDistanceScore,
  computeValueScore,
} from '../../src/ranking/service/scorer'

// ---------------------------------------------------------------------------
// computeEffectivePrice
// ---------------------------------------------------------------------------

describe('computeEffectivePrice', () => {
  it('applies 15% discount when plan matches', () => {
    const result = computeEffectivePrice(95000, 'MedPrime', ['MedPrime', 'SilverShield'])
    expect(result).toBeCloseTo(80750, 0)
  })

  it('does not apply discount when plan is not in offer list', () => {
    const result = computeEffectivePrice(95000, 'CarePlus', ['MedPrime', 'SilverShield'])
    expect(result).toBe(95000)
  })

  it('does not apply discount when insurance_plan is undefined', () => {
    const result = computeEffectivePrice(95000, undefined, ['MedPrime'])
    expect(result).toBe(95000)
  })

  it('does not apply discount when insurance_plan is empty string', () => {
    const result = computeEffectivePrice(95000, '', ['MedPrime'])
    expect(result).toBe(95000)
  })

  it('does not apply discount when insurance_plan is whitespace', () => {
    const result = computeEffectivePrice(95000, '   ', ['MedPrime'])
    expect(result).toBe(95000)
  })

  it('does not apply discount when offer has empty insurance_plans', () => {
    const result = computeEffectivePrice(95000, 'MedPrime', [])
    expect(result).toBe(95000)
  })

  it('discount is exactly 15% (multiplier 0.85)', () => {
    const original = 100
    const result = computeEffectivePrice(original, 'MedPrime', ['MedPrime'])
    expect(result).toBe(85)
  })

  it('discount applied to spec sample NC-1001 (95000 AMD, MedPrime)', () => {
    const result = computeEffectivePrice(95000, 'MedPrime', ['MedPrime', 'SilverShield'])
    expect(result).toBe(80750)
  })

  it('no discount for NC-1005 (empty insurance_plans)', () => {
    const result = computeEffectivePrice(88122.2, 'MedPrime', [])
    expect(result).toBe(88122.2)
  })

  it('insurance plan matching is case-sensitive', () => {
    // 'medprime' !== 'MedPrime'
    const result = computeEffectivePrice(95000, 'medprime', ['MedPrime'])
    expect(result).toBe(95000)
  })
})

// ---------------------------------------------------------------------------
// computeWaitScore
// ---------------------------------------------------------------------------

describe('computeWaitScore', () => {
  it('returns 1 when wait_hours is 0', () => {
    expect(computeWaitScore(0, 72)).toBe(1)
  })

  it('returns 0 when wait_hours equals max_wait_hours', () => {
    expect(computeWaitScore(72, 72)).toBe(0)
  })

  it('returns 0 when wait_hours exceeds max_wait_hours (clamped)', () => {
    expect(computeWaitScore(80, 72)).toBe(0)
  })

  it('computes correct score for NC-1001 (wait=20, max=72)', () => {
    // 1 - 20/72 = 1 - 0.2778 = 0.7222
    const result = computeWaitScore(20, 72)
    expect(result).toBeCloseTo(0.7222, 3)
  })

  it('computes correct score for NC-1005 (wait=28, max=72)', () => {
    // 1 - 28/72 ≈ 0.6111
    const result = computeWaitScore(28, 72)
    expect(result).toBeCloseTo(0.6111, 3)
  })

  it('computes correct score for CP-2001 (wait=22, max=72)', () => {
    // 1 - 22/72 ≈ 0.6944
    const result = computeWaitScore(22, 72)
    expect(result).toBeCloseTo(0.6944, 3)
  })

  it('returns value between 0 and 1 for valid inputs', () => {
    const result = computeWaitScore(36, 72)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// computeDistanceScore
// ---------------------------------------------------------------------------

describe('computeDistanceScore', () => {
  it('returns 1 when distance_km is 0', () => {
    expect(computeDistanceScore(0, 15)).toBe(1)
  })

  it('returns 0 when distance_km equals max_distance_km', () => {
    expect(computeDistanceScore(15, 15)).toBe(0)
  })

  it('returns 0 when distance_km exceeds max (clamped)', () => {
    expect(computeDistanceScore(20, 15)).toBe(0)
  })

  it('computes correct score for NC-1001 (dist=3.2, max=15)', () => {
    // 1 - 3.2/15 ≈ 0.7867
    const result = computeDistanceScore(3.2, 15)
    expect(result).toBeCloseTo(0.7867, 3)
  })

  it('computes correct score for NC-1005 (dist=11.9, max=15)', () => {
    // 1 - 11.9/15 ≈ 0.2067
    const result = computeDistanceScore(11.9, 15)
    expect(result).toBeCloseTo(0.2067, 3)
  })

  it('computes correct score for CP-2001 (dist=4.0, max=15)', () => {
    // 1 - 4.0/15 ≈ 0.7333
    const result = computeDistanceScore(4.0, 15)
    expect(result).toBeCloseTo(0.7333, 3)
  })

  it('returns value between 0 and 1 for valid inputs', () => {
    const result = computeDistanceScore(7.5, 15)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// computeValueScore
// ---------------------------------------------------------------------------

describe('computeValueScore', () => {
  it('matches spec formula: quality*0.5 + wait*25 + dist*15 - price/2000', () => {
    const quality = 88
    const waitScore = 0.7222
    const distScore = 0.7867
    const price = 80750 // NC-1001 after MedPrime discount

    const expected = quality * 0.5 + waitScore * 25 + distScore * 15 - price / 2000
    const result = computeValueScore(quality, waitScore, distScore, price)
    expect(result).toBeCloseTo(expected, 3)
  })

  it('returns higher score for lower effective price (penalty)', () => {
    const cheap = computeValueScore(80, 0.5, 0.5, 50000)
    const expensive = computeValueScore(80, 0.5, 0.5, 200000)
    expect(cheap).toBeGreaterThan(expensive)
  })

  it('returns higher score for better quality', () => {
    const highQ = computeValueScore(100, 0.5, 0.5, 50000)
    const lowQ = computeValueScore(0, 0.5, 0.5, 50000)
    expect(highQ).toBeGreaterThan(lowQ)
  })

  it('returns higher score for shorter wait', () => {
    const short = computeValueScore(80, 1.0, 0.5, 50000)
    const long = computeValueScore(80, 0.0, 0.5, 50000)
    expect(short).toBeGreaterThan(long)
  })

  it('returns higher score for closer distance', () => {
    const close = computeValueScore(80, 0.5, 1.0, 50000)
    const far = computeValueScore(80, 0.5, 0.0, 50000)
    expect(close).toBeGreaterThan(far)
  })

  it('can return negative value for very high effective price', () => {
    // price = 400000 → penalty = 200; quality+wait+dist max ~90
    const result = computeValueScore(0, 0, 0, 400000)
    expect(result).toBeLessThan(0)
  })

  it('perfect score (quality=100, wait=1, dist=1, price=0)', () => {
    // 100*0.5 + 1*25 + 1*15 - 0/2000 = 50 + 25 + 15 = 90
    const result = computeValueScore(100, 1, 1, 0)
    expect(result).toBe(90)
  })

  it('zero score when all inputs are zero', () => {
    expect(computeValueScore(0, 0, 0, 0)).toBe(0)
  })
})
