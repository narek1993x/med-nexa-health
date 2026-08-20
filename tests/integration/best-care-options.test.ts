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
import { NORTHCARE_OFFERS } from '../../src/mocks/northcare'
import { CAREPOINT_OFFERS } from '../../src/mocks/carepoint'
import { MEDCENTER_OFFERS } from '../../src/mocks/medcenter'

// ---------------------------------------------------------------------------
// Registry and FX table fixtures
// ---------------------------------------------------------------------------

const TEST_REGISTRY_JSON = JSON.stringify([
  { provider_id: 'northcare', offers_url: 'https://mock.northcare.com/offers', enabled: true },
  { provider_id: 'carepoint', offers_url: 'https://mock.carepoint.com/offers', enabled: true },
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
  it('returns results for valid spec input (NC-1001 ranked first)', async () => {
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
    expect(body.results[0].offer_id).toBe('NC-1001')
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
        patient_currency: 'US', // too short
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
        {
          provider_id: 'northcare',
          offers_url: 'https://mock.northcare.com/offers',
          enabled: true,
        },
        {
          provider_id: 'carepoint',
          offers_url: 'https://mock.carepoint.com/offers',
          enabled: false,
        },
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

// ---------------------------------------------------------------------------
// Cross-provider deduplication — MedCenter duplicate slots
// ---------------------------------------------------------------------------

describe('GET /best-care-options: cross-provider deduplication', () => {
  let threeProviderApp: FastifyInstance

  beforeAll(async () => {
    const threeProviderRegistry = loadProviderRegistry(
      JSON.stringify([
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
        {
          provider_id: 'medcenter',
          offers_url: 'https://mock.medcenter.com/offers',
          enabled: true,
        },
      ]),
    )

    threeProviderApp = Fastify({ logger: false })
    threeProviderApp.setErrorHandler(async (error, _request, reply) => {
      if (error.statusCode === 400) {
        await reply.code(400).send({ error: 'INVALID_REQUEST', message: error.message })
        return
      }
      await reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected error' })
    })
    await threeProviderApp.register(async (instance) => {
      await registerRoutes(instance, threeProviderRegistry, fxTable)
    })
    await threeProviderApp.ready()
  })

  beforeEach(() => {
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
        if (url.includes('medcenter')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MEDCENTER_OFFERS),
          })
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve([]) })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('MC-3001 is dropped — NC-1001 wins the 09:00 slot with higher value_score', async () => {
    const res = await threeProviderApp.inject({
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
    const ids = body.results.map((r) => r.offer_id)
    expect(ids).toContain('NC-1001')
    expect(ids).not.toContain('MC-3001')
  })

  it('MC-3002 is dropped — CP-2001 wins the 10:30 slot with higher value_score', async () => {
    const res = await threeProviderApp.inject({
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
    const ids = body.results.map((r) => r.offer_id)
    expect(ids).toContain('CP-2001')
    expect(ids).not.toContain('MC-3002')
  })

  it('MC-3003 appears in results — unique slot wins uncontested', async () => {
    const res = await threeProviderApp.inject({
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
    const ids = body.results.map((r) => r.offer_id)
    expect(ids).toContain('MC-3003')
  })

  it('MC-3004 appears in results — unique slot, high quality', async () => {
    const res = await threeProviderApp.inject({
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
    const ids = body.results.map((r) => r.offer_id)
    expect(ids).toContain('MC-3004')
  })

  it('MC-3005 is filtered out — city is Gyumri not Yerevan', async () => {
    const res = await threeProviderApp.inject({
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
    const ids = body.results.map((r) => r.offer_id)
    expect(ids).not.toContain('MC-3005')
  })

  it('deduplication removes MC-3001 and MC-3002 — result count reflects full mock datasets', async () => {
    const res = await threeProviderApp.inject({
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
    // All Yerevan MRI_BRAIN offers within constraints, after deduplication:
    //   NC-1001 (slot 09:00 — beats MC-3001)
    //   CP-2001 (slot 10:30 — beats MC-3002)
    //   NC-1005 (slot 18:15 — unique)
    //   NC-1002 (slot day2 13:30 — unique)
    //   CP-2002 (slot day2 09:15 — unique, EUR)
    //   CP-2004 (slot day1 06:45 — unique)
    //   MC-3003 (slot day3 08:30 — unique)
    //   MC-3004 is wait_hours=68 within 72 — unique
    // MC-3001 and MC-3002 are dropped by dedup → 2 fewer than raw input
    const ids = body.results.map((r) => r.offer_id)
    expect(ids).not.toContain('MC-3001')
    expect(ids).not.toContain('MC-3002')
    expect(body.results.length).toBeGreaterThan(0)
  })

  it('NC-1001 is still rank 1 with three providers', async () => {
    const res = await threeProviderApp.inject({
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

  it('ranks are sequential with three providers', async () => {
    const res = await threeProviderApp.inject({
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
    body.results.forEach((r, i) => {
      expect(r.rank).toBe(i + 1)
    })
  })
})
