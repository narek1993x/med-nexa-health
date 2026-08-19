/**
 * Provider registry module.
 *
 * Parses and validates the PROVIDER_REGISTRY environment variable, which
 * contains a JSON array of provider configurations. This is the mechanism
 * for zero-code provider onboarding:
 *
 *   Production:  update PROVIDER_REGISTRY env var → new provider active immediately
 *   Dev/test:    update samconfig.toml override → rebuild to pick up new mock URL
 *
 * The registry is loaded once at Lambda cold start (module-level singleton)
 * and never re-read per request.
 */

import type { ProviderConfig } from '../types'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RegistryConfigError extends Error {
  constructor(message: string) {
    // Safe message only — no internal details leaked to callers
    super(`Provider registry configuration error: ${message}`)
    this.name = 'RegistryConfigError'
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidProviderConfig(value: unknown): value is ProviderConfig {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj['provider_id'] === 'string' &&
    obj['provider_id'].trim().length > 0 &&
    typeof obj['offers_url'] === 'string' &&
    obj['offers_url'].trim().length > 0 &&
    typeof obj['enabled'] === 'boolean'
  )
}

function isValidUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses the PROVIDER_REGISTRY env var and returns all enabled providers.
 *
 * @param env - Raw value of process.env.PROVIDER_REGISTRY
 * @throws RegistryConfigError on malformed JSON, wrong shape, or invalid URL
 * @returns Array of enabled ProviderConfig entries (enabled: false filtered out)
 */
export function loadProviderRegistry(env: string | undefined): ProviderConfig[] {
  if (!env || env.trim().length === 0) {
    throw new RegistryConfigError('PROVIDER_REGISTRY environment variable is not set or empty')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(env)
  } catch {
    throw new RegistryConfigError('PROVIDER_REGISTRY is not valid JSON')
  }

  if (!Array.isArray(parsed)) {
    throw new RegistryConfigError('PROVIDER_REGISTRY must be a JSON array')
  }

  const configs: ProviderConfig[] = []

  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i]
    if (!isValidProviderConfig(entry)) {
      throw new RegistryConfigError(
        `Entry at index ${i} is missing required fields (provider_id, offers_url, enabled)`,
      )
    }
    if (!isValidUrl(entry.offers_url)) {
      throw new RegistryConfigError(
        `Entry at index ${i} has an invalid offers_url — must be a valid http/https URL`,
      )
    }
    configs.push(entry)
  }

  // Filter disabled providers — enabled: false means skip without error
  return configs.filter((c) => c.enabled)
}
