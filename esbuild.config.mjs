/**
 * esbuild bundler config for all Lambda functions.
 * Format: CJS — avoids ESM/CJS interop issues with @fastify/aws-lambda.
 * node:* and @aws-sdk/* are marked external — provided by the Lambda runtime.
 */
import { build } from 'esbuild'

const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  minify: false,
  external: ['node:*', '@aws-sdk/*'],
}

const entries = [
  { in: 'src/ranking/handler.ts', out: 'dist/ranking/handler' },
  { in: 'src/mocks/northcare.ts', out: 'dist/mocks/northcare' },
  { in: 'src/mocks/carepoint.ts', out: 'dist/mocks/carepoint' },
]

await Promise.all(
  entries.map(({ in: entryPoint, out: outfile }) =>
    build({ ...sharedConfig, entryPoints: [entryPoint], outfile: `${outfile}.js` }),
  ),
)

console.log('Build complete.')
