/**
 * Shared mock handler factory.
 *
 * Every mock provider follows the same pattern:
 *   import { createMockHandler } from './factory'
 *   export const handler = createMockHandler(offers, '/provider/<id>/offers')
 *
 * Adding a new provider mock = ~5 lines + one SAM function entry.
 * The ranking service never changes.
 *
 * Implementation: plain Node.js — no framework dependency.
 * Handles path matching (with optional stage prefix stripping), a /health
 * route, and a 404 fallback. Uses only the AWS Lambda types package.
 */

import type { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import type { Offer } from '../ranking/types'
import { resolveEventPath } from '../plugins/stripStagePrefix'

export interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function jsonResponse(statusCode: number, body: unknown): LambdaResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) }
}

export function createMockHandler(
  offers: Offer[],
  routePath = '/offers',
): (event: APIGatewayProxyEventV2, context: Context) => Promise<LambdaResponse> {
  return async (event: APIGatewayProxyEventV2, _context: Context): Promise<LambdaResponse> => {
    const method = event.requestContext.http.method.toUpperCase()
    const path = resolveEventPath(event)

    if (method === 'GET' && path === routePath) {
      return jsonResponse(200, offers)
    }

    if (method === 'GET' && path === '/health') {
      return jsonResponse(200, { status: 'ok' })
    }

    return jsonResponse(404, { message: `Route not found: ${method} ${path}` })
  }
}
