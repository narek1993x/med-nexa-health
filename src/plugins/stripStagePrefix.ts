/**
 * Stage prefix stripping for AWS HTTP API (v2).
 *
 * API Gateway includes the stage name in rawPath (e.g. /dev/best-care-options).
 * Both functions read the STAGE env var set by SAM and no-op when it is unset.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda'

/** Returns rawPath with the stage prefix removed, or rawPath as-is if absent. */
export function resolveEventPath(event: APIGatewayProxyEventV2): string {
  const raw = event.rawPath ?? '/'
  const stage = process.env['STAGE']
  if (!stage) return raw

  const prefix = `/${stage}`
  if (raw.startsWith(`${prefix}/`)) return raw.slice(prefix.length)
  if (raw === prefix) return '/'
  return raw
}

/** Returns a shallow-cloned event with rawPath and requestContext.http.path rewritten. */
export function stripStageFromEvent(event: APIGatewayProxyEventV2): APIGatewayProxyEventV2 {
  const strippedPath = resolveEventPath(event)
  if (strippedPath === (event.rawPath ?? '/')) return event

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
