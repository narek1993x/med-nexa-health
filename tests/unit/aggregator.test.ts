/**
 * Unit tests for the aggregator module.
 *
 * fetch is mocked globally so no real HTTP calls are made.
 * Tests verify: successful aggregation, partial failure, total failure,
 * malformed JSON, timeout handling, and empty registry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchProviderOffers, aggregateOffers } from '../../src/ranking/service/aggregator'
import type { ProviderConfig, Offer } from '../../src/ranking/types'
import type { FastifyBaseLogger } from 'fastify'

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

const mockLogger: FastifyBaseLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: 'info',
  silent: vi.fn(),
} as unknown as FastifyBaseLogger

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const NORTHCARE_CONFIG: ProviderConfig = {
  provider_id: 'northcare',
  offers_url: 'https://api.northcare.com/offers',
  enabled: true,
}

const CAREPOINT_CONFIG: ProviderConfig = {
  provider_id: 'carepoint',
  offers_url: 'https://api.carepoint.com/offers',
  enabled: true,
}

const NC_OFFERS: Offer[] = [
  {
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
    insurance_plans: ['MedPrime'],
  },
]

const CP_OFFERS: Offer[] = [
  {
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
    insurance_plans: ['MedPrime'],
  },
]

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

function mockFetchOk(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    }),
  )
}

function mockFetchStatus(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({}),
    }),
  )
}

function mockFetchReject(error: Error): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// fetchProviderOffers
// ---------------------------------------------------------------------------

describe('fetchProviderOffers', () => {
  it('returns offer array on successful 200 response', async () => {
    mockFetchOk(NC_OFFERS)
    const result = await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(result).toHaveLength(1)
    expect(result[0].offer_id).toBe('NC-1001')
  })

  it('returns empty array on 404 response', async () => {
    mockFetchStatus(404)
    const result = await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(result).toHaveLength(0)
  })

  it('returns empty array on 500 response', async () => {
    mockFetchStatus(500)
    const result = await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(result).toHaveLength(0)
  })

  it('returns empty array when fetch rejects (network error)', async () => {
    mockFetchReject(new Error('ECONNREFUSED'))
    const result = await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(result).toHaveLength(0)
  })

  it('returns empty array when response is not an array', async () => {
    mockFetchOk({ some: 'object' })
    const result = await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(result).toHaveLength(0)
  })

  it('returns empty array when response is a primitive', async () => {
    mockFetchOk('string response')
    const result = await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(result).toHaveLength(0)
  })

  it('returns empty array when offer objects are missing required fields', async () => {
    mockFetchOk([{ price: 100 }]) // missing offer_id, provider_id, service_code
    const result = await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(result).toHaveLength(0)
  })

  it('returns empty array on AbortError (timeout)', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    mockFetchReject(abortError)
    const result = await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(result).toHaveLength(0)
  })

  it('logs a warning on non-2xx response', async () => {
    mockFetchStatus(503)
    await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('logs a warning on fetch error', async () => {
    mockFetchReject(new Error('network down'))
    await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('never throws — always returns an array', async () => {
    mockFetchReject(new Error('catastrophic failure'))
    await expect(fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)).resolves.toEqual([])
  })

  it('returns empty array when response body is null', async () => {
    mockFetchOk(null)
    const result = await fetchProviderOffers(NORTHCARE_CONFIG, mockLogger)
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// aggregateOffers
// ---------------------------------------------------------------------------

describe('aggregateOffers', () => {
  it('merges offers from all providers on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(NC_OFFERS) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(CP_OFFERS) }),
    )

    const result = await aggregateOffers([NORTHCARE_CONFIG, CAREPOINT_CONFIG], mockLogger)
    expect(result).toHaveLength(2)
    const ids = result.map((o) => o.offer_id)
    expect(ids).toContain('NC-1001')
    expect(ids).toContain('CP-2001')
  })

  it('returns partial results when one provider fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(NC_OFFERS) })
        .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    )

    const result = await aggregateOffers([NORTHCARE_CONFIG, CAREPOINT_CONFIG], mockLogger)
    expect(result).toHaveLength(1)
    expect(result[0].offer_id).toBe('NC-1001')
  })

  it('returns empty array when all providers fail', async () => {
    mockFetchStatus(500)
    const result = await aggregateOffers([NORTHCARE_CONFIG, CAREPOINT_CONFIG], mockLogger)
    expect(result).toHaveLength(0)
  })

  it('returns empty array for empty registry', async () => {
    const result = await aggregateOffers([], mockLogger)
    expect(result).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('never throws even when all providers reject', async () => {
    mockFetchReject(new Error('all down'))
    await expect(
      aggregateOffers([NORTHCARE_CONFIG, CAREPOINT_CONFIG], mockLogger),
    ).resolves.toEqual([])
  })

  it('aggregates correctly with single provider', async () => {
    mockFetchOk(NC_OFFERS)
    const result = await aggregateOffers([NORTHCARE_CONFIG], mockLogger)
    expect(result).toHaveLength(1)
  })

  it('logs aggregation summary', async () => {
    mockFetchOk(NC_OFFERS)
    await aggregateOffers([NORTHCARE_CONFIG], mockLogger)
    expect(mockLogger.info).toHaveBeenCalled()
  })
})
