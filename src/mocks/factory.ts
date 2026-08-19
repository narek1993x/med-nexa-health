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

export function createMockHandler(offers: Offer[]): ReturnType<typeof awsLambdaFastify> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  })

  // GET /offers — returns the static offer list for this provider
  app.get('/offers', async (_request, reply) => {
    await reply.code(200).send(offers)
  })

  // Health check — useful for SAM local and ALB target group checks
  app.get('/health', async (_request, reply) => {
    await reply.code(200).send({ status: 'ok' })
  })

  return awsLambdaFastify(app)
}
