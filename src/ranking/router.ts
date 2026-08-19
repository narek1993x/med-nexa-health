/**
 * Fastify router for the ranking service.
 *
 * Defines GET /best-care-options with strict JSON Schema validation on all
 * query parameters. Validation failures return 400 before reaching service
 * logic — no stack traces or internals are exposed in error responses.
 *
 * The route handler orchestrates the full ranking pipeline:
 *   aggregateOffers → filter → FX + score → dedup → rank → respond
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { randomUUID } from 'crypto'

import { aggregateOffers } from './service/aggregator'
import { filterByServiceAndCity, filterByConstraints } from './service/filter'
import { convertPrice } from './service/fx'
import { computeEffectivePrice, computeWaitScore, computeDistanceScore, computeValueScore } from './service/scorer'
import { deduplicateBySlot } from './service/deduplicator'
import { rankOffers } from './service/ranker'

import type { ProviderConfig, FxTable, ScoredOffer, RankingResponse } from './types'

// ---------------------------------------------------------------------------
// Query string schema (Fastify JSON Schema validation)
// ---------------------------------------------------------------------------

const bestCareOptionsSchema = {
  querystring: {
    type: 'object',
    required: ['service_code', 'city', 'patient_currency', 'max_distance_km', 'max_wait_hours'],
    additionalProperties: false,
    properties: {
      service_code: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
        description: 'Medical service code (e.g. MRI_BRAIN)',
      },
      city: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        description: 'City to search in',
      },
      patient_currency: {
        type: 'string',
        minLength: 3,
        maxLength: 3,
        description: 'ISO 4217 currency code (e.g. AMD)',
      },
      max_distance_km: {
        type: 'number',
        minimum: 0,
        maximum: 10000,
        description: 'Maximum distance in kilometres',
      },
      max_wait_hours: {
        type: 'number',
        minimum: 0,
        maximum: 8760, // 1 year
        description: 'Maximum acceptable wait in hours',
      },
      insurance_plan: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
        description: 'Optional insurance plan name for discount eligibility',
      },
    },
  },
} as const

// ---------------------------------------------------------------------------
// Query string type (matches schema above)
// ---------------------------------------------------------------------------

interface BestCareOptionsQuery {
  service_code: string
  city: string
  patient_currency: string
  max_distance_km: number
  max_wait_hours: number
  insurance_plan?: string
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Registers all ranking service routes on the Fastify instance.
 * Called once during Lambda cold start in handler.ts.
 */
export async function registerRoutes(
  app: FastifyInstance,
  registry: ProviderConfig[],
  fxTable: FxTable,
): Promise<void> {
  // Health check — used by SAM local and AWS target group health checks
  app.get('/health', async (_req: FastifyRequest, reply: FastifyReply) => {
    await reply.code(200).send({ status: 'ok', service: 'med-nexa-ranking' })
  })

  // Main ranking endpoint
  app.get<{ Querystring: BestCareOptionsQuery }>(
    '/best-care-options',
    { schema: bestCareOptionsSchema },
    async (request: FastifyRequest<{ Querystring: BestCareOptionsQuery }>, reply: FastifyReply) => {
      const requestId = randomUUID()
      const {
        service_code,
        city,
        patient_currency,
        max_distance_km,
        max_wait_hours,
        insurance_plan,
      } = request.query

      request.log.info(
        {
          request_id: requestId,
          service_code,
          city,
          patient_currency,
          max_distance_km,
          max_wait_hours,
          has_insurance: !!insurance_plan,
        },
        'Ranking request received',
      )

      // -----------------------------------------------------------------------
      // Step 1: Fetch all providers in parallel
      // -----------------------------------------------------------------------
      const rawOffers = await aggregateOffers(registry, request.log)

      // -----------------------------------------------------------------------
      // Step 2: Filter by service_code + city
      // -----------------------------------------------------------------------
      const serviceFiltered = filterByServiceAndCity(rawOffers, service_code, city)

      // -----------------------------------------------------------------------
      // Step 3: Filter by distance + wait constraints
      // -----------------------------------------------------------------------
      const constraintFiltered = filterByConstraints(serviceFiltered, max_distance_km, max_wait_hours)

      request.log.info(
        {
          request_id: requestId,
          raw_count: rawOffers.length,
          after_service_filter: serviceFiltered.length,
          after_constraint_filter: constraintFiltered.length,
        },
        'Filtering complete',
      )

      // -----------------------------------------------------------------------
      // Step 4–6: FX convert + compute effective price + score each offer
      // -----------------------------------------------------------------------
      const scoredOffers: ScoredOffer[] = []

      for (const offer of constraintFiltered) {
        let convertedPrice: number
        try {
          convertedPrice = convertPrice(offer.price_amount, offer.currency, patient_currency, fxTable)
        } catch {
          // Unknown currency pair — skip this offer rather than failing the request
          request.log.warn(
            { offer_id: offer.offer_id, from: offer.currency, to: patient_currency },
            'Skipping offer — no FX rate available for currency pair',
          )
          continue
        }

        const effectivePrice = computeEffectivePrice(
          convertedPrice,
          insurance_plan,
          offer.insurance_plans,
        )
        const waitScore = computeWaitScore(offer.wait_hours, max_wait_hours)
        const distanceScore = computeDistanceScore(offer.distance_km, max_distance_km)
        const valueScore = computeValueScore(
          offer.quality_score,
          waitScore,
          distanceScore,
          effectivePrice,
        )

        scoredOffers.push({
          ...offer,
          converted_price: convertedPrice,
          effective_price: effectivePrice,
          wait_score: waitScore,
          distance_score: distanceScore,
          value_score: valueScore,
          insurance_applied:
            !!insurance_plan &&
            insurance_plan.trim().length > 0 &&
            offer.insurance_plans.includes(insurance_plan.trim()),
        })
      }

      // -----------------------------------------------------------------------
      // Step 7: Deduplicate by slot (keeps highest value_score per slot)
      // -----------------------------------------------------------------------
      const dedupedOffers = deduplicateBySlot(scoredOffers)

      request.log.info(
        {
          request_id: requestId,
          before_dedup: scoredOffers.length,
          after_dedup: dedupedOffers.length,
        },
        'Deduplication complete',
      )

      // -----------------------------------------------------------------------
      // Step 8: Rank and build response
      // -----------------------------------------------------------------------
      const rankedOffers = rankOffers(dedupedOffers)

      const response: RankingResponse = {
        request_id: requestId,
        service_code,
        city,
        patient_currency,
        results: rankedOffers,
        ...(rankedOffers.length === 0
          ? { warning: 'No matching offers found for the given criteria' }
          : {}),
      }

      request.log.info(
        {
          request_id: requestId,
          result_count: rankedOffers.length,
          top_value_score: rankedOffers[0]?.value_score ?? null,
        },
        'Ranking response dispatched',
      )

      await reply.code(200).send(response)
    },
  )
}
