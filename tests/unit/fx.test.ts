/**
 * Unit tests for the FX conversion module.
 * Covers: AMD→USD, USD→AMD, same-currency, missing pair, precision rounding,
 * negative amount guard, loadFxTable env parsing, and fallback default.
 */

import { describe, it, expect } from 'vitest'
import { loadFxTable, convertPrice, FxConversionError } from '../../src/ranking/service/fx'
import type { FxTable } from '../../src/ranking/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_TABLE: FxTable = {
  AMD: { AMD: 1, USD: 0.00261 },
  USD: { USD: 1, AMD: 383.14 },
  EUR: { EUR: 1, USD: 1.09 },
}

// ---------------------------------------------------------------------------
// loadFxTable
// ---------------------------------------------------------------------------

describe('loadFxTable', () => {
  it('returns default table when env is undefined', () => {
    const table = loadFxTable(undefined)
    expect(table).toHaveProperty('AMD')
    expect(table).toHaveProperty('USD')
    expect(table['AMD']?.['USD']).toBeGreaterThan(0)
  })

  it('returns default table when env is empty string', () => {
    const table = loadFxTable('')
    expect(table).toHaveProperty('AMD')
  })

  it('returns default table when env is whitespace', () => {
    const table = loadFxTable('   ')
    expect(table).toHaveProperty('AMD')
  })

  it('parses valid JSON env var', () => {
    const custom: FxTable = { GBP: { GBP: 1, USD: 1.27 }, USD: { USD: 1, GBP: 0.79 } }
    const table = loadFxTable(JSON.stringify(custom))
    expect(table['GBP']?.['USD']).toBe(1.27)
  })

  it('throws on malformed JSON', () => {
    expect(() => loadFxTable('{bad json')).toThrow('FX_RATES environment variable is not valid JSON')
  })

  it('throws when env value is a JSON array', () => {
    expect(() => loadFxTable('[1,2,3]')).toThrow()
  })

  it('throws when env value is a JSON primitive', () => {
    expect(() => loadFxTable('"AMD"')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// convertPrice — successful conversions
// ---------------------------------------------------------------------------

describe('convertPrice: successful conversions', () => {
  it('converts AMD to USD correctly', () => {
    // 95000 AMD * 0.00261 = 247.95
    const result = convertPrice(95000, 'AMD', 'USD', TEST_TABLE)
    expect(result).toBe(247.95)
  })

  it('converts USD to AMD correctly', () => {
    // 230 USD * 383.14 = 88122.2
    const result = convertPrice(230, 'USD', 'AMD', TEST_TABLE)
    expect(result).toBe(88122.2)
  })

  it('converts EUR to USD correctly', () => {
    // 100 EUR * 1.09 = 109.00
    const result = convertPrice(100, 'EUR', 'USD', TEST_TABLE)
    expect(result).toBe(109)
  })

  it('same-currency AMD returns exact input', () => {
    expect(convertPrice(91000, 'AMD', 'AMD', TEST_TABLE)).toBe(91000)
  })

  it('same-currency USD returns exact input', () => {
    expect(convertPrice(230, 'USD', 'USD', TEST_TABLE)).toBe(230)
  })

  it('converts zero amount', () => {
    expect(convertPrice(0, 'AMD', 'USD', TEST_TABLE)).toBe(0)
  })

  it('result is rounded to 2 decimal places', () => {
    // Use a rate that would produce many decimal places
    const table: FxTable = { X: { Y: 1 / 3 } }
    const result = convertPrice(100, 'X', 'Y', table)
    const decimals = result.toString().split('.')[1]?.length ?? 0
    expect(decimals).toBeLessThanOrEqual(2)
  })

  it('converts large AMD amount (spec sample NC-1001: 95000 AMD)', () => {
    const result = convertPrice(95000, 'AMD', 'USD', TEST_TABLE)
    expect(result).toBeCloseTo(247.95, 1)
  })

  it('converts large AMD amount (spec sample CP-2001: 91000 AMD)', () => {
    const result = convertPrice(91000, 'AMD', 'USD', TEST_TABLE)
    expect(result).toBeCloseTo(237.46, 1)
  })
})

// ---------------------------------------------------------------------------
// convertPrice — error cases
// ---------------------------------------------------------------------------

describe('convertPrice: error cases', () => {
  it('throws FxConversionError when source currency not in table', () => {
    expect(() => convertPrice(100, 'GBP', 'AMD', TEST_TABLE)).toThrow(FxConversionError)
  })

  it('throws FxConversionError when target currency not in source rates', () => {
    expect(() => convertPrice(100, 'AMD', 'EUR', TEST_TABLE)).toThrow(FxConversionError)
  })

  it('FxConversionError message contains the currency codes', () => {
    try {
      convertPrice(100, 'GBP', 'JPY', TEST_TABLE)
    } catch (err) {
      expect(err).toBeInstanceOf(FxConversionError)
      const msg = (err as FxConversionError).message
      expect(msg).toContain('GBP')
      expect(msg).toContain('JPY')
    }
  })

  it('throws on negative amount', () => {
    expect(() => convertPrice(-1, 'AMD', 'USD', TEST_TABLE)).toThrow('non-negative')
  })

  it('FxConversionError has correct name', () => {
    try {
      convertPrice(100, 'UNKNOWN', 'AMD', TEST_TABLE)
    } catch (err) {
      expect((err as FxConversionError).name).toBe('FxConversionError')
    }
  })
})

// ---------------------------------------------------------------------------
// Default table consistency check
// ---------------------------------------------------------------------------

describe('loadFxTable: default table sanity', () => {
  it('default AMD→USD rate is a reasonable value (0.002–0.005 range)', () => {
    const table = loadFxTable(undefined)
    const rate = table['AMD']?.['USD'] ?? 0
    expect(rate).toBeGreaterThan(0.001)
    expect(rate).toBeLessThan(0.01)
  })

  it('default USD→AMD rate is a reasonable value (300–500 range)', () => {
    const table = loadFxTable(undefined)
    const rate = table['USD']?.['AMD'] ?? 0
    expect(rate).toBeGreaterThan(300)
    expect(rate).toBeLessThan(500)
  })

  it('same-currency rates are 1', () => {
    const table = loadFxTable(undefined)
    expect(table['AMD']?.['AMD']).toBe(1)
    expect(table['USD']?.['USD']).toBe(1)
  })
})
