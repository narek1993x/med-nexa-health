/**
 * Unit tests for mock provider handlers.
 *
 * Offer data is imported directly from the mock source files — single source
 * of truth. Any change to the mock data is automatically reflected here.
 */

import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import type { Offer } from '../../src/ranking/types'
import { NORTHCARE_OFFERS } from '../../src/mocks/northcare'
import { CAREPOINT_OFFERS } from '../../src/mocks/carepoint'

// ---------------------------------------------------------------------------
// Helper — build a minimal Fastify app serving a static offer list
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
// NorthCare
// ---------------------------------------------------------------------------

describe('Mock provider: NorthCare', () => {
  it('returns 200 with all 5 offers', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })

    expect(res.statusCode).toBe(200)
    expect(res.json<Offer[]>()).toHaveLength(5)
  })

  it('all offers have provider_id northcare', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })

    res.json<Offer[]>().forEach((o) => expect(o.provider_id).toBe('northcare'))
  })

  it('contains NC-1001 through NC-1005', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const ids = res.json<Offer[]>().map((o) => o.offer_id)

    expect(ids).toContain('NC-1001')
    expect(ids).toContain('NC-1002')
    expect(ids).toContain('NC-1003')
    expect(ids).toContain('NC-1004')
    expect(ids).toContain('NC-1005')
  })

  it('NC-1001 has AMD currency, MedPrime insurance, and correct price', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const nc1001 = res.json<Offer[]>().find((o) => o.offer_id === 'NC-1001')

    expect(nc1001?.currency).toBe('AMD')
    expect(nc1001?.price_amount).toBe(95000)
    expect(nc1001?.insurance_plans).toContain('MedPrime')
    expect(nc1001?.insurance_plans).toContain('SilverShield')
  })

  it('NC-1005 has USD currency and empty insurance plans', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const nc1005 = res.json<Offer[]>().find((o) => o.offer_id === 'NC-1005')

    expect(nc1005?.currency).toBe('USD')
    expect(nc1005?.price_amount).toBe(230)
    expect(nc1005?.insurance_plans).toHaveLength(0)
  })

  it('NC-1004 is in Gyumri (different city)', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const nc1004 = res.json<Offer[]>().find((o) => o.offer_id === 'NC-1004')

    expect(nc1004?.city).toBe('Gyumri')
  })

  it('NC-1003 is CT_CHEST service (different service code)', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const nc1003 = res.json<Offer[]>().find((o) => o.offer_id === 'NC-1003')

    expect(nc1003?.service_code).toBe('CT_CHEST')
  })

  it('returns health check 200', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json<{ status: string }>().status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// CarePoint
// ---------------------------------------------------------------------------

describe('Mock provider: CarePoint', () => {
  it('returns 200 with all 5 offers', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })

    expect(res.statusCode).toBe(200)
    expect(res.json<Offer[]>()).toHaveLength(5)
  })

  it('all offers have provider_id carepoint', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })

    res.json<Offer[]>().forEach((o) => expect(o.provider_id).toBe('carepoint'))
  })

  it('contains CP-2001 through CP-2005', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const ids = res.json<Offer[]>().map((o) => o.offer_id)

    expect(ids).toContain('CP-2001')
    expect(ids).toContain('CP-2002')
    expect(ids).toContain('CP-2003')
    expect(ids).toContain('CP-2004')
    expect(ids).toContain('CP-2005')
  })

  it('CP-2001 is in Yerevan with MedPrime insurance', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const cp2001 = res.json<Offer[]>().find((o) => o.offer_id === 'CP-2001')

    expect(cp2001?.city).toBe('Yerevan')
    expect(cp2001?.insurance_plans).toContain('MedPrime')
    expect(cp2001?.quality_score).toBe(86)
  })

  it('CP-2002 has EUR currency', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const cp2002 = res.json<Offer[]>().find((o) => o.offer_id === 'CP-2002')

    expect(cp2002?.currency).toBe('EUR')
    expect(cp2002?.price_amount).toBe(210)
  })

  it('CP-2005 is in Vanadzor (different city)', async () => {
    const app = await buildMockApp(CAREPOINT_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
    const cp2005 = res.json<Offer[]>().find((o) => o.offer_id === 'CP-2005')

    expect(cp2005?.city).toBe('Vanadzor')
    expect(cp2005?.insurance_plans).not.toContain('MedPrime')
  })
})

// ---------------------------------------------------------------------------
// Factory edge cases
// ---------------------------------------------------------------------------

describe('Mock factory: edge cases', () => {
  it('returns empty array when no offers provided', async () => {
    const app = await buildMockApp([])
    const res = await app.inject({ method: 'GET', url: '/offers' })

    expect(res.statusCode).toBe(200)
    expect(res.json<Offer[]>()).toHaveLength(0)
  })

  it('returns single offer correctly', async () => {
    const app = await buildMockApp([NORTHCARE_OFFERS[0]])
    const res = await app.inject({ method: 'GET', url: '/offers' })

    expect(res.json<Offer[]>()).toHaveLength(1)
    expect(res.json<Offer[]>()[0].offer_id).toBe('NC-1001')
  })

  it('all required Offer fields are present', async () => {
    const app = await buildMockApp(NORTHCARE_OFFERS)
    const res = await app.inject({ method: 'GET', url: '/offers' })
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

    res.json<Offer[]>().forEach((offer) => {
      requiredFields.forEach((field) => expect(offer).toHaveProperty(field))
    })
  })
})
