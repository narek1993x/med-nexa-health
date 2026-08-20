/**
 * Integration tests for GET /config/options.
 *
 * Tests the full pipeline end-to-end by:
 *   - Wiring Fastify + all service modules together (same as production)
 *   - Mocking fetch so provider calls return the spec sample payloads
 *   - Asserting the full ConfigOptions response shape and exact values
 *
 * Uses Fastify inject — no HTTP server, no ports, fast CI execution.
 *
 * Expected output from spec mock data:
 *   service_codes:   ['CT_CHEST', 'MRI_BRAIN']
 *   cities:          ['Gyumri', 'Vanadzor', 'Yerevan']
 *   currencies:      ['AMD', 'EUR', 'USD']
 *   insurance_plans: ['CarePlus', 'MedPrime', 'SilverShield']
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerRoutes } from '../../src/ranking/router'
import { loadProviderRegistry } from '../../src/ranking/service/registry'
import { loadFxTable } from '../../src/ranking/service/fx'
import type { ConfigOptions } from '../../src/ranking/types'
import { NORTHCARE_OFFERS } from '../../src/mocks/northcare'
import { CAREPOINT_OFFERS } from '../../src/mocks/carepoint'

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
// Happy path
// ---------------------------------------------------------------------------

describe('GET /config/options: happy path', () => {
  it('returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/config/options' })
    expect(res.statusCode).toBe(200)
  })

  it('response has all four required fields as arrays', async () => {
    const res = await app.inject({ method: 'GET', url: '/config/options' })
    const body = res.json<ConfigOptions>()
    expect(Array.isArray(body.service_codes)).toBe(true)
    expect(Array.isArray(body.cities)).toBe(true)
    expect(Array.isArray(body.currencies)).toBe(true)
    expect(Array.isArray(body.insurance_plans)).toBe(true)
  })

  it('service_codes contains the expected values from mock data', async () => {
    const res = await app.inject({ method: 'GET', url: '/config/options' })
    const body = res.json<ConfigOptions>()
    expect(body.service_codes).toContain('MRI_BRAIN')
    expect(body.service_codes).toContain('CT_CHEST')
  })

  it('cities contains all expected values from mock data', async () => {
    const res = await app.inject({ method: 'GET', url: '/config/options' })
    const body = res.json<ConfigOptions>()
    expect(body.cities).toContain('Yerevan')
    expect(body.cities).toContain('Gyumri')
    expect(body.cities).toContain('Vanadzor')
  })

  it('currencies contains all expected values from mock data', async () => {
    const res = await app.inject({ method: 'GET', url: '/config/options' })
    const body = res.json<ConfigOptions>()
    expect(body.currencies).toContain('AMD')
    expect(body.currencies).toContain('USD')
    expect(body.currencies).toContain('EUR')
  })

  it('insurance_plans contains all expected values from mock data', async () => {
    const res = await app.inject({ method: 'GET', url: '/config/options' })
    const body = res.json<ConfigOptions>()
    expect(body.insurance_plans).toContain('MedPrime')
    expect(body.insurance_plans).toContain('SilverShield')
    expect(body.insurance_plans).toContain('CarePlus')
  })

  it('all arrays are sorted alphabetically', async () => {
    const res = await app.inject({ method: 'GET', url: '/config/options' })
    const body = res.json<ConfigOptions>()

    const isSorted = (arr: string[]): boolean =>
      arr.every((val, i) => i === 0 || val >= arr[i - 1]!)

    expect(isSorted(body.service_codes)).toBe(true)
    expect(isSorted(body.cities)).toBe(true)
    expect(isSorted(body.currencies)).toBe(true)
    expect(isSorted(body.insurance_plans)).toBe(true)
  })

  it('service_codes has no duplicates', async () => {
    const res = await app.inject({ method: 'GET', url: '/config/options' })
    const body = res.json<ConfigOptions>()
    expect(new Set(body.service_codes).size).toBe(body.service_codes.length)
  })

  it('insurance_plans has no duplicates', async () => {
    const res = await app.inject({ method: 'GET', url: '/config/options' })
    const body = res.json<ConfigOptions>()
    expect(new Set(body.insurance_plans).size).toBe(body.insurance_plans.length)
  })

  it('returns exact expected values from spec mock data', async () => {
    const res = await app.inject({ method: 'GET', url: '/config/options' })
    const body = res.json<ConfigOptions>()
    expect(body.service_codes).toEqual(['CT_CHEST', 'MRI_BRAIN'])
    expect(body.cities).toEqual(['Gyumri', 'Vanadzor', 'Yerevan'])
    expect(body.currencies).toEqual(['AMD', 'EUR', 'USD'])
    expect(body.insurance_plans).toEqual(['CarePlus', 'MedPrime', 'SilverShield'])
  })
})

// ---------------------------------------------------------------------------
// Provider resilience
// ---------------------------------------------------------------------------

describe('GET /config/options: provider resilience', () => {
  it('returns empty arrays when all providers fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('all down')))

    const res = await app.inject({ method: 'GET', url: '/config/options' })
    expect(res.statusCode).toBe(200)
    const body = res.json<ConfigOptions>()
    expect(body.service_codes).toHaveLength(0)
    expect(body.cities).toHaveLength(0)
    expect(body.currencies).toHaveLength(0)
    expect(body.insurance_plans).toHaveLength(0)
  })

  it('returns partial data when one provider fails', async () => {
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

    const res = await app.inject({ method: 'GET', url: '/config/options' })
    expect(res.statusCode).toBe(200)
    const body = res.json<ConfigOptions>()
    // northcare-only data — cities include Yerevan and Gyumri (from NC-1004) but not Vanadzor (carepoint-only)
    expect(body.cities).toContain('Yerevan')
    expect(body.cities).not.toContain('Vanadzor')
  })
})

// ---------------------------------------------------------------------------
// Disabled provider
// ---------------------------------------------------------------------------

describe('GET /config/options: disabled provider', () => {
  it('only fetches from enabled providers', async () => {
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

    const res = await partialApp.inject({ method: 'GET', url: '/config/options' })
    expect(res.statusCode).toBe(200)
    const body = res.json<ConfigOptions>()

    // Vanadzor comes from carepoint (CP-2005) only — should be absent
    expect(body.cities).not.toContain('Vanadzor')
    // EUR comes from carepoint (CP-2002) only — should be absent
    expect(body.currencies).not.toContain('EUR')
    // CarePlus appears in northcare (NC-1004) AND carepoint — should still be present
    expect(body.insurance_plans).toContain('MedPrime')

    await partialApp.close()
  })
})
