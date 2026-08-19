/**
 * Shared mock handler factory.
 *
 * Every mock provider follows the same pattern:
 *   import { createMockHandler } from './factory'
 *   export const handler = createMockHandler(offers, '/provider/<id>/offers')
 *
 * Adding a new provider mock = ~5 lines + one SAM function entry.
 * The ranking service never changes.
 */

import awsLambdaFastify from '@fastify/aws-lambda'
import Fastify from 'fastify'
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import type { Offer } from '../ranking/types'
import { stripStageFromEvent } from '../plugins/stripStagePrefix'

export function createMockHandler(
  offers: Offer[],
  routePath = '/offers',
): (event: APIGatewayProxyEventV2, context: Context) => Promise<unknown> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  })

  // GET <routePath> — returns the static offer list for this provider
  app.get(routePath, async (_request, reply) => {
    await reply.code(200).send(offers)
  })

  // Health check — useful for SAM local and ALB target group checks
  app.get('/health', async (_request, reply) => {
    await reply.code(200).send({ status: 'ok' })
  })

  const proxy = awsLambdaFastify(app)

  return async (event: APIGatewayProxyEventV2, context: Context) => {
    await app.ready()
    return proxy(stripStageFromEvent(event), context)
  }
}
