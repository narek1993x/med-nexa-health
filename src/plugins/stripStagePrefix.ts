/**
 * Fastify plugin — strips the API Gateway stage prefix from the request URL.
 *
 * AWS HTTP API (v2) includes the stage name in rawPath:
 *   /dev/best-care-options → /best-care-options
 *
 * @fastify/aws-lambda's retainStage logic only handles REST API (v1) events,
 * so we strip it ourselves via an onRequest hook.
 *
 * Usage:
 *   app.register(stripStagePrefix)
 *
 * Reads STAGE env var set by SAM from the Environment CloudFormation parameter.
 * No-ops when STAGE is unset (local dev / unit tests).
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

const stripStagePrefix: FastifyPluginAsync = async (app: FastifyInstance) => {
  const stage = process.env['STAGE']
  if (!stage) return

  const prefix = `/${stage}`

  app.addHook('onRequest', async (request, _reply) => {
    const url: string = request.raw.url ?? '/'
    if (url.startsWith(`${prefix}/`) || url === prefix) {
      request.raw.url = url.slice(prefix.length) || '/'
    }
  })
}

export default fp(stripStagePrefix, {
  fastify: '5.x',
  name: 'strip-stage-prefix',
})
