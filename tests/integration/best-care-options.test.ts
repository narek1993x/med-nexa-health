/**
 * Integration tests for GET /best-care-options.
 *
 * Tests the full pipeline end-to-end by:
 *   - Wiring Fastify + all service modules together (same as production)
 *   - Mocking fetch so provider calls return the spec sample payloads
 *   - Asserting the full ranked response shape and values
 *
 * Uses Fastify inject — no HTTP server, no ports, fast CI execution.
 *
 * Manual expected rank order (patient_currency=AMD, max_dist=15, max_wait=72, insurance=MedPrime):
 *   Rank 1: NC-1001  value_score ≈ 33.48
 *   Rank 2: CP-2001  value_score ≈ 32.69
 *   Rank 3: NC-1005  value_score ≈ 19.32
 *   (CP-2005 filtered out — city=Vanadzor != Yerevan)
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerRoutes } from '../../src/ranking/router'
import { loadProviderRegistry } from '../../src/ranking/service/registry'
import { loadFxTable } from '../../src/ranking/service/fx'
import type { RankingResponse, RankedOffer } from '../../src/ranking/types'

// ---------------------------------------------------------------------------
// Spec sample payloads (exact values from the spec)
// ---------------------------------------------------------------------------

const NORTHCARE_OFFERS = [
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
    insurance_plans: ['MedPrime', 'SilverShield'],
  },
  {
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
  },
]

const CAREPOINT_OFFERS = [
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
    insurance_plans: ['MedPrime', 'CarePlus'],
  },
  {
    offer_id: 'CP-2005',
    provider_id: 'carepoint',
    service_code: 'MRI_BRAIN',
    city: 'Vanadzor',
    currency: 'AMD',
    price_amount: 76000,
    earliest_slot_utc: '2026-09-05T11:00:00Z',
    wait_hours: 60,
    distance_km: 3.5,
    quality_score: 78,
    insurance_plans: ['CarePlus'],
  },
]

// ---------------------------------------------------------------------------
// Registry and FX table fixtures
// ---------------------------------------------------------------------------

const TEST_REGISTRY_JSON = JSON.stringify([
  {
    provider_id: 'northcare',
    offers_url: 'https://mock.northcare.com/offers',
    enabled: true,
  },
  {
    provider_id: 'carepoint',
    offers_url: 'https://mock.carepoint.com/offers',
    enabled: true,
  },
])

const registry = loadProviderRegistry(TEST_REGISTRY_JSON)
const fxTable = loadFxTable(undefined) // default AMD/USD rates

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.setErrorHandler(async (error, _request, reply) => {
    if (error.statusCode === 400) {
      await reply.code(400).send({
        error: 'INVALID_REQUEST',
        message: error.message,
      })
      return
    }
    await reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected error' })
  })

  await app.register(async (instance) => {
    await registerRoutes(instance, registry, fxTable)
  })

  await app.ready()
  return app
}

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

function mockProviderFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('northcare')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(NORTHCARE_OFFERS),
        })
      }
      if (url.includes('carepoint')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(CAREPOINT_OFFERS),
        })
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve([]) })
    }),
  )
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
})

beforeEach(() => {
  mockProviderFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Happy path — full spec scenario
// ---------------------------------------------------------------------------

describe('GET /best-care-options: happy path', () => {
  it('returns 200 with results for valid spec input', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
        insurance_plan: 'MedPrime',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<RankingResponse>()
    expect(body.results.length).toBeGreaterThan(0)
  })

  it('returns exactly 3 results for spec sample input (CP-2005 filtered by city)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
        insurance_plan: 'MedPrime',
      },
    })

    const body = res.json<RankingResponse>()
    expect(body.results).toHaveLength(3)
  })

  it('NC-1001 is ranked first', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
        insurance_plan: 'MedPrime',
      },
    })

    const body = res.json<RankingResponse>()
    expect(body.results[0].offer_id).toBe('NC-1001')
    expect(body.results[0].rank).toBe(1)
  })

  it('CP-2001 is ranked second', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
        insurance_plan: 'MedPrime',
      },
    })

    const body = res.json<RankingResponse>()
    expect(body.results[1].offer_id).toBe('CP-2001')
    expect(body.results[1].rank).toBe(2)
  })

  it('NC-1005 is ranked third (no insurance, high price penalty)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
        insurance_plan: 'MedPrime',
      },
    })

    const body = res.json<RankingResponse>()
    expect(body.results[2].offer_id).toBe('NC-1005')
    expect(body.results[2].rank).toBe(3)
  })

  it('response contains all required top-level fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    const body = res.json<RankingResponse>()
    expect(body).toHaveProperty('request_id')
    expect(body).toHaveProperty('service_code', 'MRI_BRAIN')
    expect(body).toHaveProperty('city', 'Yerevan')
    expect(body).toHaveProperty('patient_currency', 'AMD')
    expect(body).toHaveProperty('results')
    expect(Array.isArray(body.results)).toBe(true)
  })

  it('request_id is a valid UUID v4', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    const body = res.json<RankingResponse>()
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    expect(body.request_id).toMatch(uuidRegex)
  })

  it('each result has all required fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
        insurance_plan: 'MedPrime',
      },
    })

    const body = res.json<RankingResponse>()
    body.results.forEach((result: RankedOffer) => {
      expect(result).toHaveProperty('rank')
      expect(result).toHaveProperty('offer_id')
      expect(result).toHaveProperty('provider_id')
      expect(result).toHaveProperty('effective_price')
      expect(result).toHaveProperty('wait_hours')
      expect(result).toHaveProperty('distance_km')
      expect(result).toHaveProperty('quality_score')
      expect(result).toHaveProperty('value_score')
      expect(result).toHaveProperty('reason_code')
      expect(result).toHaveProperty('reason')
    })
  })

  it('ranks are sequential starting at 1', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    const body = res.json<RankingResponse>()
    body.results.forEach((result: RankedOffer, i: number) => {
      expect(result.rank).toBe(i + 1)
    })
  })

  it('insurance discount reduces effective_price for NC-1001', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
        insurance_plan: 'MedPrime',
      },
    })

    const body = res.json<RankingResponse>()
    const nc1001 = body.results.find((r) => r.offer_id === 'NC-1001')
    expect(nc1001).toBeDefined()
    // 95000 * 0.85 = 80750
    expect(nc1001?.effective_price).toBeCloseTo(80750, 0)
  })

  it('value_scores are sorted descending', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
        insurance_plan: 'MedPrime',
      },
    })

    const body = res.json<RankingResponse>()
    const scores = body.results.map((r) => r.value_score)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i] ?? 0)
    }
  })

  it('CP-2005 (Vanadzor) is excluded when city=Yerevan', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    const body = res.json<RankingResponse>()
    const ids = body.results.map((r) => r.offer_id)
    expect(ids).not.toContain('CP-2005')
  })
})

// ---------------------------------------------------------------------------
// Filtering behaviour
// ---------------------------------------------------------------------------

describe('GET /best-care-options: filtering', () => {
  it('returns empty results when max_distance_km is very small', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '0.5',
        max_wait_hours: '72',
      },
    })

    const body = res.json<RankingResponse>()
    expect(body.results).toHaveLength(0)
    expect(body.warning).toBeDefined()
  })

  it('returns empty results for unmatched city', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Tbilisi',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    const body = res.json<RankingResponse>()
    expect(body.results).toHaveLength(0)
    expect(body.warning).toBeDefined()
  })

  it('returns empty results for unmatched service_code', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'CT_SCAN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    const body = res.json<RankingResponse>()
    expect(body.results).toHaveLength(0)
  })

  it('excludes NC-1005 when max_wait_hours is 24 (wait=28)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '24',
      },
    })

    const body = res.json<RankingResponse>()
    const ids = body.results.map((r) => r.offer_id)
    expect(ids).not.toContain('NC-1005')
  })
})

// ---------------------------------------------------------------------------
// Provider resilience
// ---------------------------------------------------------------------------

describe('GET /best-care-options: provider resilience', () => {
  it('returns results from remaining provider when one fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('northcare')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(NORTHCARE_OFFERS),
          })
        }
        // carepoint is down
        return Promise.reject(new Error('ECONNREFUSED'))
      }),
    )

    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<RankingResponse>()
    const ids = body.results.map((r) => r.offer_id)
    expect(ids).toContain('NC-1001')
    expect(ids).not.toContain('CP-2001')
  })

  it('returns 200 with empty results when all providers fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('all down')))

    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<RankingResponse>()
    expect(body.results).toHaveLength(0)
    expect(body.warning).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Input validation — 400 responses
// ---------------------------------------------------------------------------

describe('GET /best-care-options: input validation', () => {
  it('returns 400 when service_code is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json<{ error: string }>()
    expect(body.error).toBe('INVALID_REQUEST')
  })

  it('returns 400 when city is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when patient_currency is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when max_distance_km is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_wait_hours: '72',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when max_wait_hours is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('400 response does not contain stack trace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: { city: 'Yerevan' },
    })

    const raw = res.body
    expect(raw).not.toContain('at ')
    expect(raw).not.toContain('node:')
    expect(raw).not.toContain('Error:')
  })

  it('returns 400 when patient_currency is not 3 characters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'US',  // too short
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('insurance_plan is optional — omitting it returns 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    expect(res.statusCode).toBe(200)
  })

  it('request_id differs between two calls (UUID is unique)', async () => {
    const query = {
      service_code: 'MRI_BRAIN',
      city: 'Yerevan',
      patient_currency: 'AMD',
      max_distance_km: '15',
      max_wait_hours: '72',
    }

    const res1 = await app.inject({ method: 'GET', url: '/best-care-options', query })
    const res2 = await app.inject({ method: 'GET', url: '/best-care-options', query })

    const id1 = res1.json<RankingResponse>().request_id
    const id2 = res2.json<RankingResponse>().request_id
    expect(id1).not.toBe(id2)
  })
})

// ---------------------------------------------------------------------------
// Disabled provider in registry
// ---------------------------------------------------------------------------

describe('GET /best-care-options: registry with disabled provider', () => {
  it('only fetches enabled providers', async () => {
    const partialRegistry = loadProviderRegistry(
      JSON.stringify([
        { provider_id: 'northcare', offers_url: 'https://mock.northcare.com/offers', enabled: true },
        { provider_id: 'carepoint', offers_url: 'https://mock.carepoint.com/offers', enabled: false },
      ]),
    )

    const partialApp = Fastify({ logger: false })
    partialApp.setErrorHandler(async (error, _request, reply) => {
      if (error.statusCode === 400) {
        await reply.code(400).send({ error: 'INVALID_REQUEST', message: error.message })
        return
      }
      await reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected error' })
    })
    await partialApp.register(async (instance) => {
      await registerRoutes(instance, partialRegistry, fxTable)
    })
    await partialApp.ready()

    const res = await partialApp.inject({
      method: 'GET',
      url: '/best-care-options',
      query: {
        service_code: 'MRI_BRAIN',
        city: 'Yerevan',
        patient_currency: 'AMD',
        max_distance_km: '15',
        max_wait_hours: '72',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<RankingResponse>()
    // Only northcare results — carepoint disabled
    const ids = body.results.map((r) => r.offer_id)
    expect(ids).not.toContain('CP-2001')
    expect(ids).toContain('NC-1001')

    await partialApp.close()
  })
})

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns 200 with ok status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ status: string }>().status).toBe('ok')
  })
})
