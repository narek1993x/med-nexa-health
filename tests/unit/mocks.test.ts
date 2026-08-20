/**
 * Unit tests for mock provider handlers (createMockHandler factory).
 *
 * Exercises routing, response shape, edge cases, and stage-prefix stripping.
 * Offer data is imported directly — single source of truth.
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import type { Offer } from '../../src/ranking/types'
import { createMockHandler } from '../../src/mocks/factory'
import { NORTHCARE_OFFERS } from '../../src/mocks/northcare'
import { CAREPOINT_OFFERS } from '../../src/mocks/carepoint'

function makeEvent(method: string, path: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789',
      apiId: 'test',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      requestId: 'test-req-id',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1735689600000,
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
    },
    isBase64Encoded: false,
  }
}

const CONTEXT = {} as Parameters<ReturnType<typeof createMockHandler>>[1]

// ---------------------------------------------------------------------------
// Provider payload shape
// ---------------------------------------------------------------------------

describe('Mock provider: NorthCare', () => {
  const handler = createMockHandler(NORTHCARE_OFFERS, '/provider/northcare/offers')

  it('returns all 5 offers with correct ids, provider_id, and spot-check fields', async () => {
    const res = await handler(makeEvent('GET', '/provider/northcare/offers'), CONTEXT)
    const offers = JSON.parse(res.body) as Offer[]

    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('application/json')
    expect(offers).toHaveLength(5)
    expect(offers.map((o) => o.offer_id)).toEqual(
      expect.arrayContaining(['NC-1001', 'NC-1002', 'NC-1003', 'NC-1004', 'NC-1005']),
    )
    offers.forEach((o) => expect(o.provider_id).toBe('northcare'))

    const nc1001 = offers.find((o) => o.offer_id === 'NC-1001')
    expect(nc1001).toMatchObject({
      currency: 'AMD',
      price_amount: 95000,
      insurance_plans: expect.arrayContaining(['MedPrime']),
    })

    const nc1005 = offers.find((o) => o.offer_id === 'NC-1005')
    expect(nc1005).toMatchObject({ currency: 'USD', price_amount: 230, insurance_plans: [] })
  })

  it('all required Offer fields are present on every offer', async () => {
    const res = await handler(makeEvent('GET', '/provider/northcare/offers'), CONTEXT)
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
    ;(JSON.parse(res.body) as Offer[]).forEach((offer) =>
      requiredFields.forEach((field) => expect(offer).toHaveProperty(field)),
    )
  })
})

describe('Mock provider: CarePoint', () => {
  const handler = createMockHandler(CAREPOINT_OFFERS, '/provider/carepoint/offers')

  it('returns all 5 offers with correct ids, provider_id, and spot-check fields', async () => {
    const res = await handler(makeEvent('GET', '/provider/carepoint/offers'), CONTEXT)
    const offers = JSON.parse(res.body) as Offer[]

    expect(res.statusCode).toBe(200)
    expect(offers).toHaveLength(5)
    expect(offers.map((o) => o.offer_id)).toEqual(
      expect.arrayContaining(['CP-2001', 'CP-2002', 'CP-2003', 'CP-2004', 'CP-2005']),
    )
    offers.forEach((o) => expect(o.provider_id).toBe('carepoint'))

    const cp2001 = offers.find((o) => o.offer_id === 'CP-2001')
    expect(cp2001).toMatchObject({
      city: 'Yerevan',
      quality_score: 86,
      insurance_plans: expect.arrayContaining(['MedPrime']),
    })

    const cp2005 = offers.find((o) => o.offer_id === 'CP-2005')
    expect(cp2005).toMatchObject({ city: 'Vanadzor', insurance_plans: ['CarePlus'] })
  })
})

// ---------------------------------------------------------------------------
// Factory routing & edge cases
// ---------------------------------------------------------------------------

describe('Mock factory: routing and edge cases', () => {
  const handler = createMockHandler(NORTHCARE_OFFERS, '/provider/northcare/offers')

  it('returns 200 on /health', async () => {
    const res = await handler(makeEvent('GET', '/health'), CONTEXT)
    expect(res.statusCode).toBe(200)
    expect((JSON.parse(res.body) as { status: string }).status).toBe('ok')
  })

  it('returns 404 for unknown routes', async () => {
    const res = await handler(makeEvent('GET', '/unknown'), CONTEXT)
    expect(res.statusCode).toBe(404)
  })

  it('uses /offers as the default route', async () => {
    const h = createMockHandler(NORTHCARE_OFFERS)
    const res = await h(makeEvent('GET', '/offers'), CONTEXT)
    expect(res.statusCode).toBe(200)
  })

  it('normalises HTTP method to uppercase', async () => {
    const event = makeEvent('GET', '/provider/northcare/offers')
    // @ts-expect-error -- intentionally passing lowercase to test toUpperCase() in factory
    event.requestContext.http.method = 'get'
    const res = await handler(event, CONTEXT)
    expect(res.statusCode).toBe(200)
  })

  it('returns empty array when no offers provided', async () => {
    const h = createMockHandler([], '/provider/test/offers')
    const res = await h(makeEvent('GET', '/provider/test/offers'), CONTEXT)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body) as Offer[]).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Stage prefix stripping (resolveEventPath integration)
// ---------------------------------------------------------------------------

describe('Mock factory: stage prefix stripping', () => {
  afterEach(() => {
    delete process.env['STAGE']
  })

  it('strips stage prefix and serves offers', async () => {
    process.env['STAGE'] = 'dev'
    const handler = createMockHandler(NORTHCARE_OFFERS, '/provider/northcare/offers')
    const res = await handler(makeEvent('GET', '/dev/provider/northcare/offers'), CONTEXT)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body) as Offer[]).toHaveLength(5)
  })

  it('strips stage prefix on /health', async () => {
    process.env['STAGE'] = 'dev'
    const handler = createMockHandler(NORTHCARE_OFFERS, '/provider/northcare/offers')
    const res = await handler(makeEvent('GET', '/dev/health'), CONTEXT)
    expect(res.statusCode).toBe(200)
  })

  it('returns 404 when path does not match after stripping', async () => {
    process.env['STAGE'] = 'dev'
    const handler = createMockHandler(NORTHCARE_OFFERS, '/provider/northcare/offers')
    const res = await handler(makeEvent('GET', '/dev/unknown'), CONTEXT)
    expect(res.statusCode).toBe(404)
  })
})
