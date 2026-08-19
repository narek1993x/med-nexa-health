/**
 * Lambda entrypoint for the ranking service.
 *
 * Initialisation happens at module scope (cold start) — the registry and FX
 * table are loaded once and reused across all warm invocations.
 *
 * Top-level await is avoided intentionally: CJS output format (used by SAM
 * esbuild) does not support it. Instead we use a promise-based init pattern —
 * the exported handler waits for the app to be ready before processing events.
 */

import awsLambdaFastify from '@fastify/aws-lambda'
import Fastify from 'fastify'
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda'

import { loadProviderRegistry } from './service/registry'
import { loadFxTable } from './service/fx'
import { registerRoutes } from './router'
import stripStagePrefix from '../plugins/stripStagePrefix'

// ---------------------------------------------------------------------------
// Cold-start initialisation — runs once per Lambda container lifetime
// ---------------------------------------------------------------------------

const registry = loadProviderRegistry(process.env['PROVIDER_REGISTRY'])
const fxTable = loadFxTable(process.env['FX_RATES'])

const app = Fastify({
  logger: {
    level: process.env['LOG_LEVEL'] ?? 'info',
    formatters: {
      level(label: string) {
        return { level: label }
      },
    },
  },
  disableRequestLogging: false,
})

// Strip API Gateway stage prefix for HTTP API v2
app.register(stripStagePrefix)

app.setErrorHandler(
  async (error: { message?: string; code?: string; statusCode?: number }, _request, reply) => {
    app.log.error(
      { err: { message: error.message ?? 'unknown', code: error.code ?? 'unknown' } },
      'Unhandled application error',
    )
    if (error.statusCode === 400) {
      await reply.code(400).send({
        error: 'INVALID_REQUEST',
        message: error.message ?? 'Bad request',
      })
      return
    }
    await reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
    })
  },
)

// ---------------------------------------------------------------------------
// App init promise — avoids top-level await (incompatible with CJS output)
// The Lambda proxy waits for this to resolve before forwarding the first event.
// ---------------------------------------------------------------------------

const appReady = app
  .register(async (instance) => {
    await registerRoutes(instance, registry, fxTable)
  })
  .ready()

const proxy = awsLambdaFastify(app)

// ---------------------------------------------------------------------------
// Lambda handler export
// ---------------------------------------------------------------------------

export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<unknown> {
  await appReady
  return proxy(event, context)
}
