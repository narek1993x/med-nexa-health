/**
 * Unit tests for the provider registry module.
 * Covers: valid input, disabled filtering, malformed JSON, missing fields,
 * invalid URLs, empty array, and edge cases.
 */

import { describe, it, expect } from 'vitest'
import { loadProviderRegistry, RegistryConfigError } from '../../src/ranking/service/registry'
import type { ProviderConfig } from '../../src/ranking/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validRegistry: ProviderConfig[] = [
  { provider_id: 'northcare', offers_url: 'https://api.northcare.com/offers', enabled: true },
  { provider_id: 'carepoint', offers_url: 'https://api.carepoint.com/offers', enabled: true },
]

const registryWithDisabled: ProviderConfig[] = [
  { provider_id: 'northcare', offers_url: 'https://api.northcare.com/offers', enabled: true },
  { provider_id: 'carepoint', offers_url: 'https://api.carepoint.com/offers', enabled: false },
  { provider_id: 'westmed', offers_url: 'https://api.westmed.com/offers', enabled: true },
]

// ---------------------------------------------------------------------------
// Valid input
// ---------------------------------------------------------------------------

describe('loadProviderRegistry: valid input', () => {
  it('parses a valid registry with two enabled providers', () => {
    const result = loadProviderRegistry(JSON.stringify(validRegistry))

    expect(result).toHaveLength(2)
    expect(result[0].provider_id).toBe('northcare')
    expect(result[1].provider_id).toBe('carepoint')
  })

  it('returns provider_id, offers_url, and enabled for each entry', () => {
    const result = loadProviderRegistry(JSON.stringify(validRegistry))

    result.forEach((config) => {
      expect(config).toHaveProperty('provider_id')
      expect(config).toHaveProperty('offers_url')
      expect(config).toHaveProperty('enabled')
    })
  })

  it('returns empty array for an empty registry', () => {
    const result = loadProviderRegistry('[]')
    expect(result).toHaveLength(0)
  })

  it('accepts http:// URLs (not just https)', () => {
    const registry = [
      { provider_id: 'local', offers_url: 'http://localhost:3000/offers', enabled: true },
    ]
    const result = loadProviderRegistry(JSON.stringify(registry))
    expect(result).toHaveLength(1)
    expect(result[0].provider_id).toBe('local')
  })

  it('returns a single enabled provider from a single-entry registry', () => {
    const single = [{ provider_id: 'northcare', offers_url: 'https://northcare.com/offers', enabled: true }]
    const result = loadProviderRegistry(JSON.stringify(single))
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Disabled provider filtering
// ---------------------------------------------------------------------------

describe('loadProviderRegistry: disabled provider filtering', () => {
  it('filters out disabled providers', () => {
    const result = loadProviderRegistry(JSON.stringify(registryWithDisabled))

    expect(result).toHaveLength(2)
    const ids = result.map((c) => c.provider_id)
    expect(ids).toContain('northcare')
    expect(ids).toContain('westmed')
    expect(ids).not.toContain('carepoint')
  })

  it('returns empty array when all providers are disabled', () => {
    const allDisabled = validRegistry.map((c) => ({ ...c, enabled: false }))
    const result = loadProviderRegistry(JSON.stringify(allDisabled))
    expect(result).toHaveLength(0)
  })

  it('returns all providers when all are enabled', () => {
    const result = loadProviderRegistry(JSON.stringify(validRegistry))
    expect(result).toHaveLength(2)
    result.forEach((c) => expect(c.enabled).toBe(true))
  })
})

// ---------------------------------------------------------------------------
// Error cases — malformed input
// ---------------------------------------------------------------------------

describe('loadProviderRegistry: error cases', () => {
  it('throws RegistryConfigError when env is undefined', () => {
    expect(() => loadProviderRegistry(undefined)).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when env is empty string', () => {
    expect(() => loadProviderRegistry('')).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when env is whitespace', () => {
    expect(() => loadProviderRegistry('   ')).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError on malformed JSON', () => {
    expect(() => loadProviderRegistry('{not valid json')).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when root is an object, not an array', () => {
    expect(() => loadProviderRegistry('{"provider_id":"northcare"}')).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when root is a string', () => {
    expect(() => loadProviderRegistry('"northcare"')).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when an entry is missing provider_id', () => {
    const bad = [{ offers_url: 'https://northcare.com/offers', enabled: true }]
    expect(() => loadProviderRegistry(JSON.stringify(bad))).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when an entry is missing offers_url', () => {
    const bad = [{ provider_id: 'northcare', enabled: true }]
    expect(() => loadProviderRegistry(JSON.stringify(bad))).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when an entry is missing enabled', () => {
    const bad = [{ provider_id: 'northcare', offers_url: 'https://northcare.com/offers' }]
    expect(() => loadProviderRegistry(JSON.stringify(bad))).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when provider_id is empty string', () => {
    const bad = [{ provider_id: '', offers_url: 'https://northcare.com/offers', enabled: true }]
    expect(() => loadProviderRegistry(JSON.stringify(bad))).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when offers_url is not a valid URL', () => {
    const bad = [{ provider_id: 'northcare', offers_url: 'not-a-url', enabled: true }]
    expect(() => loadProviderRegistry(JSON.stringify(bad))).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when offers_url uses ftp protocol', () => {
    const bad = [{ provider_id: 'northcare', offers_url: 'ftp://northcare.com/offers', enabled: true }]
    expect(() => loadProviderRegistry(JSON.stringify(bad))).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when an array entry is null', () => {
    expect(() => loadProviderRegistry('[null]')).toThrow(RegistryConfigError)
  })

  it('throws RegistryConfigError when an array entry is a primitive', () => {
    expect(() => loadProviderRegistry('[42]')).toThrow(RegistryConfigError)
  })

  it('error message does not contain internal stack details', () => {
    try {
      loadProviderRegistry(undefined)
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryConfigError)
      const message = (err as RegistryConfigError).message
      expect(message).not.toContain('at ')     // no stack trace
      expect(message).not.toContain('node:')   // no node internals
    }
  })
})
