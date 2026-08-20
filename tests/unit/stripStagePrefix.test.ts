/**
 * Unit tests for src/plugins/stripStagePrefix.ts
 *
 * resolveEventPath  — returns the stage-stripped path string
 * stripStageFromEvent — returns a shallow-cloned event with paths rewritten
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { resolveEventPath, stripStageFromEvent } from '../../src/plugins/stripStagePrefix'

function makeEvent(rawPath: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `GET ${rawPath}`,
    rawPath,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789',
      apiId: 'test',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      requestId: 'test-req-id',
      routeKey: `GET ${rawPath}`,
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1735689600000,
      http: {
        method: 'GET',
        path: rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
    },
    isBase64Encoded: false,
  }
}

afterEach(() => {
  delete process.env['STAGE']
})

// ---------------------------------------------------------------------------
// resolveEventPath
// ---------------------------------------------------------------------------

describe('resolveEventPath', () => {
  it('returns rawPath unchanged when STAGE is not set', () => {
    expect(resolveEventPath(makeEvent('/best-care-options'))).toBe('/best-care-options')
    expect(resolveEventPath(makeEvent('/'))).toBe('/')
  })

  it('falls back to / when rawPath is undefined', () => {
    const event = makeEvent('/')
    // @ts-expect-error -- testing undefined rawPath guard
    event.rawPath = undefined
    expect(resolveEventPath(event)).toBe('/')
  })

  it('strips the stage prefix from a path', () => {
    process.env['STAGE'] = 'dev'
    expect(resolveEventPath(makeEvent('/dev/best-care-options'))).toBe('/best-care-options')
  })

  it('returns / when path is exactly the bare stage prefix', () => {
    process.env['STAGE'] = 'dev'
    expect(resolveEventPath(makeEvent('/dev'))).toBe('/')
  })

  it('returns path unchanged when prefix is absent or only partially matches', () => {
    process.env['STAGE'] = 'dev'
    expect(resolveEventPath(makeEvent('/other/path'))).toBe('/other/path')
    // /devious starts with /dev but is not /dev/ or /dev exactly
    expect(resolveEventPath(makeEvent('/devious/path'))).toBe('/devious/path')
  })
})

// ---------------------------------------------------------------------------
// stripStageFromEvent
// ---------------------------------------------------------------------------

describe('stripStageFromEvent', () => {
  it('returns the original event reference when no stripping is needed', () => {
    // No STAGE set
    const noStage = makeEvent('/best-care-options')
    expect(stripStageFromEvent(noStage)).toBe(noStage)

    // STAGE set but path has no prefix
    process.env['STAGE'] = 'dev'
    const noMatch = makeEvent('/other/path')
    expect(stripStageFromEvent(noMatch)).toBe(noMatch)
  })

  it('returns a cloned event with rawPath and http.path rewritten when prefix matches', () => {
    process.env['STAGE'] = 'dev'
    const event = makeEvent('/dev/best-care-options')
    const result = stripStageFromEvent(event)

    expect(result).not.toBe(event)
    expect(result.rawPath).toBe('/best-care-options')
    expect(result.requestContext.http.path).toBe('/best-care-options')
    // Other fields untouched
    expect(result.version).toBe(event.version)
    expect(result.requestContext.accountId).toBe(event.requestContext.accountId)
    expect(result.requestContext.http.method).toBe(event.requestContext.http.method)
  })

  it('strips bare stage prefix to /', () => {
    process.env['STAGE'] = 'dev'
    const result = stripStageFromEvent(makeEvent('/dev'))
    expect(result.rawPath).toBe('/')
    expect(result.requestContext.http.path).toBe('/')
  })
})
