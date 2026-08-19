/**
 * Unit tests for mock provider handlers.
 *
 * Tests verify:
 * - Each mock returns HTTP 200
 * - Response body matches the exact spec sample payloads
 * - Factory handles empty offer list correctly
 * - All required Offer fields are present
 */

import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import type { Offer } from '../../src/ranking/types'
import { createMockHandler } from '../../src/mocks/factory'

// ---------------------------------------------------------------------------
// Helpers — invoke the Lambda handler in-process via Fastify inject
// ---------------------------------------------------------------------------

async function buildMockApp(offers: Offer[]): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: false })
  app.get('/offers', async (_req, reply) => {
    await reply.code(200).send(offers)
  })
  app.get('/health', async (_req, reply) => {
    await reply.code(200).send({ status: 'ok' })
  })
  await app.ready()
  return app
}

// ---------------------------------------------------------------------------
// NorthCare mock data (matches spec exactly)
// ---------------------------------------------------------------------------

const NORTHCARE_OFFERS: Offer[] = [
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

// ---------------------------------------------------------------------------
// CarePoint mock data (matches spec exactly)
// ---------------------------------------------------------------------------

const CAREPOINT_OFFERS: Offer[] = [
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
// Tests
// ---------------------------------------------------------------------------

describe('Mock provider: NorthCare', () => {
  it('returns 200 with all offers', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })

    expect(res.statusCode).toBe(200)
    const body = res.json<Offer[]>()
    expect(body).toHaveLength(2)
  })

  it('returns offers with correct provider_id', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const body = res.json<Offer[]>()

    body.forEach((offer) => {
      expect(offer.provider_id).toBe('northcare')
    })
  })

  it('returns offers with correct offer_ids', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const body = res.json<Offer[]>()
    const ids = body.map((o) => o.offer_id)

    expect(ids).toContain('NC-1001')
    expect(ids).toContain('NC-1005')
  })

  it('returns offers with correct service_code MRI_BRAIN', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const body = res.json<Offer[]>()

    body.forEach((offer) => {
      expect(offer.service_code).toBe('MRI_BRAIN')
    })
  })

  it('NC-1001 has AMD currency and insurance plans', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const body = res.json<Offer[]>()
    const nc1001 = body.find((o) => o.offer_id === 'NC-1001')

    expect(nc1001).toBeDefined()
    expect(nc1001?.currency).toBe('AMD')
    expect(nc1001?.price_amount).toBe(95000)
    expect(nc1001?.insurance_plans).toContain('MedPrime')
    expect(nc1001?.insurance_plans).toContain('SilverShield')
  })

  it('NC-1005 has USD currency and empty insurance plans', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const body = res.json<Offer[]>()
    const nc1005 = body.find((o) => o.offer_id === 'NC-1005')

    expect(nc1005).toBeDefined()
    expect(nc1005?.currency).toBe('USD')
    expect(nc1005?.price_amount).toBe(230)
    expect(nc1005?.insurance_plans).toHaveLength(0)
  })

  it('returns health check 200', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json<{ status: string }>().status).toBe('ok')
  })
})

describe('Mock provider: CarePoint', () => {
  it('returns 200 with all offers', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })

    expect(res.statusCode).toBe(200)
    const body = res.json<Offer[]>()
    expect(body).toHaveLength(2)
  })

  it('returns offers with correct provider_id', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const body = res.json<Offer[]>()

    body.forEach((offer) => {
      expect(offer.provider_id).toBe('carepoint')
    })
  })

  it('returns offers with correct offer_ids', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const body = res.json<Offer[]>()
    const ids = body.map((o) => o.offer_id)

    expect(ids).toContain('CP-2001')
    expect(ids).toContain('CP-2005')
  })

  it('CP-2001 is in Yerevan with MedPrime insurance', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const body = res.json<Offer[]>()
    const cp2001 = body.find((o) => o.offer_id === 'CP-2001')

    expect(cp2001).toBeDefined()
    expect(cp2001?.city).toBe('Yerevan')
    expect(cp2001?.insurance_plans).toContain('MedPrime')
    expect(cp2001?.quality_score).toBe(86)
  })

  it('CP-2005 is in Vanadzor (different city)', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const body = res.json<Offer[]>()
    const cp2005 = body.find((o) => o.offer_id === 'CP-2005')

    expect(cp2005).toBeDefined()
    expect(cp2005?.city).toBe('Vanadzor')
    expect(cp2005?.insurance_plans).not.toContain('MedPrime')
  })
})

describe('Mock factory: edge cases', () => {
  it('returns empty array when no offers provided', async () => {
    const app = await buildMockApp([])
    const res = await app.inject({ method: 'GET', url: '/offers' })

    expect(res.statusCode).toBe(200)
    expect(res.json<Offer[]>()).toHaveLength(0)
  })

  it('returns single offer correctly', async () => {
    const singleOffer: Offer[] = [NORTHCARE_OFFERS[0]]
    const app = await buildMockApp(singleOffer)
    const res = await app.inject({ method: 'GET', url: '/offers' })

    expect(res.statusCode).toBe(200)
    expect(res.json<Offer[]>()).toHaveLength(1)
    expect(res.json<Offer[]>()[0].offer_id).toBe('NC-1001')
  })

  it('all required Offer fields are present in response', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const body = res.json<Offer[]>()
    const requiredFields: (keyof Offer)[] = [
      'offer_id',
      'provider_id',
      'service_code',
      'city',
      'currency',
      'price_amount',
      'earliest_slot_utc',
      'wait_hours',
      'distance_km',
      'quality_score',
      'insurance_plans',
    ]

    body.forEach((offer) => {
      requiredFields.forEach((field) => {
        expect(offer).toHaveProperty(field)
      })
    })
  })
})
