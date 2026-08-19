/**
 * Aggregator module.
 *
 * Fetches offers from all registered providers in parallel using
 * Promise.allSettled — one provider failing never blocks the others.
 *
 * Resilience contract:
 *   - Timeout after 5 seconds per provider
 *   - Any failure (timeout, 4xx, 5xx, JSON parse error) returns [] for that provider
 *   - All-providers-down returns [] — ranking proceeds gracefully with no results
 *   - Errors are logged at warn level; never thrown to the caller
 */

import type { Offer, ProviderConfig } from '../types'
import type { FastifyBaseLogger } from 'fastify'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates that a parsed value looks like an Offer array.
 * Minimal structural check — full validation happens in the type system.
 */
function isOfferArray(value: unknown): value is Offer[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>)['offer_id'] === 'string' &&
        typeof (item as Record<string, unknown>)['provider_id'] === 'string' &&
        typeof (item as Record<string, unknown>)['service_code'] === 'string',
    )
  )
}

// ---------------------------------------------------------------------------
// Single provider fetch
// ---------------------------------------------------------------------------

/**
 * Fetches offers from a single provider endpoint with a 5-second timeout.
 *
 * @returns Offer[] on success, [] on any failure
 */
export async function fetchProviderOffers(
  config: ProviderConfig,
  logger: FastifyBaseLogger,
): Promise<Offer[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(config.offers_url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      logger.warn(
        { provider_id: config.provider_id, status: response.status },
        'Provider returned non-2xx status',
      )
      return []
    }

    const body: unknown = await response.json()

    if (!isOfferArray(body)) {
      logger.warn(
        { provider_id: config.provider_id },
        'Provider response is not a valid offer array',
      )
      return []
    }

    return body
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    logger.warn(
      {
        provider_id: config.provider_id,
        error: err instanceof Error ? err.message : 'unknown error',
        timed_out: isTimeout,
      },
      isTimeout ? 'Provider request timed out' : 'Provider fetch failed',
    )
    return []
  } finally {
    clearTimeout(timeoutId)
  }
}

// ---------------------------------------------------------------------------
// Parallel aggregation
// ---------------------------------------------------------------------------

/**
 * Fetches all registered providers in parallel and merges results.
 *
 * Uses Promise.allSettled so a provider rejection never propagates.
 * Fulfilled results are merged; rejected results are logged and skipped.
 *
 * @param registry - Enabled provider configs from the registry module
 * @param logger   - Fastify logger (structured JSON output)
 * @returns Merged array of all offers from all responding providers
 */
export async function aggregateOffers(
  registry: ProviderConfig[],
  logger: FastifyBaseLogger,
): Promise<Offer[]> {
  if (registry.length === 0) {
    logger.warn('Provider registry is empty — no offers to aggregate')
    return []
  }

  const fetchStart = Date.now()

  const results = await Promise.allSettled(
    registry.map((config) => fetchProviderOffers(config, logger)),
  )

  const allOffers: Offer[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const config = registry[i]

    if (result.status === 'fulfilled') {
      logger.info(
        {
          provider_id: config?.provider_id,
          offer_count: result.value.length,
          fetch_ms: Date.now() - fetchStart,
        },
        'Provider offers fetched',
      )
      allOffers.push(...result.value)
    } else {
      // Should not happen since fetchProviderOffers never rejects,
      // but guard defensively for any unexpected Promise rejection.
      logger.warn(
        {
          provider_id: config?.provider_id,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        },
        'Provider fetch settled as rejected (unexpected)',
      )
    }
  }

  logger.info(
    { total_offers: allOffers.length, providers_queried: registry.length },
    'Aggregation complete',
  )

  return allOffers
}
