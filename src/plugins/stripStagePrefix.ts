/**
 * Stage prefix stripping for AWS HTTP API (v2).
 *
 * API Gateway HTTP API includes the stage name in rawPath:
 *   /dev/best-care-options → /best-care-options
 *
 * @fastify/aws-lambda's retainStage logic only handles REST API (v1) events.
 * onRequest hooks are also too late — Fastify's router has already matched
 * (or failed to match) the path by then.
 *
 * The correct fix is to mutate the event before passing it to the proxy,
 * stripping the stage segment from rawPath and requestContext.http.path.
 *
 * Usage:
 *   return proxy(stripStageFromEvent(event), context)
 *
 * Reads STAGE env var set by SAM from the Environment CloudFormation parameter.
 * No-ops when STAGE is unset (local dev / unit tests).
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda'

export function stripStageFromEvent(event: APIGatewayProxyEventV2): APIGatewayProxyEventV2 {
  const stage = process.env['STAGE']
  if (!stage) return event

  const prefix = `/${stage}`
  const rawPath = event.rawPath ?? ''
  if (!rawPath.startsWith(`${prefix}/`) && rawPath !== prefix) return event

  const strippedPath = rawPath.slice(prefix.length) || '/'

  return {
    ...event,
    rawPath: strippedPath,
    requestContext: {
      ...event.requestContext,
      http: {
        ...event.requestContext.http,
        path: strippedPath,
      },
    },
  }
}
