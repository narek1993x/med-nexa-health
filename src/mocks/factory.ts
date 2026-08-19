/**
 * Shared mock handler factory.
 *
 * Every mock provider follows the same pattern:
 *   import { createMockHandler } from './factory'
 *   import { PROVIDER_OFFERS } from './data/provider'
 *   export const handler = createMockHandler(PROVIDER_OFFERS)
 *
 * Adding a new provider mock = ~5 lines + one SAM function entry.
 * The ranking service never changes.
 */

import awsLambdaFastify from '@fastify/aws-lambda'
import Fastify from 'fastify'
import type { Offer } from '../ranking/types'
import stripStagePrefix from '../plugins/stripStagePrefix'

export function createMockHandler(
  offers: Offer[],
  routePath = '/offers',
): ReturnType<typeof awsLambdaFastify> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  })

  // Strip API Gateway stage prefix for HTTP API v2
  app.register(stripStagePrefix)

  // GET <routePath> — returns the static offer list for this provider
  app.get(routePath, async (_request, reply) => {
    await reply.code(200).send(offers)
  })

  // Health check — useful for SAM local and ALB target group checks
  app.get('/health', async (_request, reply) => {
    await reply.code(200).send({ status: 'ok' })
  })

  return awsLambdaFastify(app)
}
