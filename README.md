# MedNexa Health — Unified Care Offer Ranking Service

A production-quality, cloud-native REST API that aggregates healthcare appointment
offers from multiple providers, applies FX conversion, insurance discounts, and a
composite value scoring algorithm to return a ranked list of the best care options
for a patient.

---

## Architecture

```
Client
  │
  ▼
API Gateway (HTTP API v2)
  │
  ▼
Ranking Lambda (TypeScript / Node.js 22 / Fastify 5)
  ├── reads PROVIDER_REGISTRY env var at cold start
  ├── fetches all providers in parallel (Promise.allSettled)
  │     ├── NorthCare Mock Lambda  →  GET /provider/northcare/offers
  │     └── CarePoint Mock Lambda  →  GET /provider/carepoint/offers
  │
  ├── filter by service_code + city (case-insensitive)
  ├── filter by max_distance_km + max_wait_hours (inclusive)
  ├── FX convert prices to patient_currency
  ├── compute effective_price (insurance discount ×0.85)
  ├── compute wait_score, distance_score, value_score
  ├── deduplicate by (service_code, city, earliest_slot_utc) → keep highest value_score
  ├── sort by value_score desc, effective_price asc
  └── assign rank + reason_code + reason string
  │
  ▼
Structured JSON logs (pino) → stdout → CloudWatch Logs
```

### Stack decisions

| Concern            | Choice                      | Rationale                                                                     |
| ------------------ | --------------------------- | ----------------------------------------------------------------------------- |
| Runtime            | TypeScript / Node.js 22     | Strong typing, fast cold starts, native `fetch`                               |
| Framework          | Fastify 5                   | Built-in JSON Schema validation, lowest Lambda overhead                       |
| Lambda adapter     | `@fastify/aws-lambda` 6.4.1 | Canonical Fastify↔Lambda bridge                                              |
| IaC                | AWS SAM                     | Purpose-built for Lambda + API Gateway, esbuild bundler built in              |
| Bundle format      | CJS (not ESM)               | `@fastify/aws-lambda` uses `require()` internally — ESM causes runtime errors |
| Architecture       | arm64 (Graviton2)           | Better price/performance for Node workloads                                   |
| CI/CD auth         | OIDC — no stored keys       | Role assumption via GitHub OIDC provider                                      |
| Provider discovery | `PROVIDER_REGISTRY` env var | Zero-code provider onboarding — update env var, no redeploy                   |
| FX conversion      | Static in-memory table      | No external dependency, no latency, overridable via `FX_RATES` env var        |
| Resilience         | `Promise.allSettled`        | One provider down never fails the request                                     |
| Logging            | pino → stdout → CloudWatch  | Structured JSON, zero overhead                                                |

---

## Ranking pipeline

```
value_score = (quality_score × 0.5)
            + (wait_score × 25)
            + (distance_score × 15)
            − (effective_price / 2000)

where:
  effective_price = converted_price × 0.85   if insurance_plan matches (case-sensitive)
                  | converted_price           otherwise

  wait_score     = max(0, 1 − wait_hours / max_wait_hours)
  distance_score = max(0, 1 − distance_km / max_distance_km)
```

Deduplication groups offers sharing the same `(service_code, city, earliest_slot_utc)`
and keeps the highest `value_score` per slot — tie goes to the lowest `effective_price`.

---

## Project structure

```
med-nexa-health/
├── src/
│   ├── ranking/
│   │   ├── handler.ts          # Lambda entrypoint — promise-based init, no top-level await
│   │   ├── router.ts           # GET /best-care-options + GET /config/options routes
│   │   ├── types.ts            # Shared TypeScript interfaces (incl. ConfigOptions)
│   │   └── service/
│   │       ├── registry.ts     # PROVIDER_REGISTRY env var parser
│   │       ├── aggregator.ts   # Parallel provider fetch (5 s timeout)
│   │       ├── fx.ts           # FX_RATES parser + currency conversion
│   │       ├── filter.ts       # Service/city + distance/wait filters
│   │       ├── scorer.ts       # value_score formula
│   │       ├── deduplicator.ts # Slot-level deduplication
│   │       ├── ranker.ts       # Sort + rank + reason generation
│   │       └── config.ts       # deriveConfigOptions — extracts unique filter values
│   ├── mocks/
│   │   ├── factory.ts          # Shared mock handler factory
│   │   ├── northcare.ts        # NorthCare mock Lambda (NC-1001, NC-1005)
│   │   └── carepoint.ts        # CarePoint mock Lambda (CP-2001, CP-2005)
│   └── plugins/
│       └── stripStagePrefix.ts # Strips API Gateway stage from event.rawPath before routing
├── tests/
│   ├── unit/                   # Pure function tests (registry, fx, filter, scorer, deduplicator, ranker, aggregator, mocks)
│   └── integration/            # Full pipeline via Fastify inject (no HTTP server needed)
├── template.yaml               # AWS SAM template — 3 Lambdas + HTTP API
├── samconfig.toml              # SAM deploy profiles (dev / staging / prod)
├── tsconfig.json               # CommonJS output — required for @fastify/aws-lambda
├── tsconfig.eslint.json        # Extended tsconfig covering tests/ for ESLint
├── esbuild.config.mjs          # Local esbuild config (SAM uses its own via template.yaml)
└── .github/workflows/
    └── deploy.yml              # CI/CD: lint → type-check → test → SAM build → deploy → smoke test
```

---

## Local development

### Prerequisites

- Node.js 22
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) (v1.162.0+)
- [Docker](https://docs.docker.com/get-docker/) — required for `sam local`
- AWS CLI configured for your dev account

### Install dependencies

```bash
npm install
```

### Run tests

```bash
# All tests (unit + integration)
npm test

# With coverage report — gate is 85% lines/branches/functions
npm run test:coverage

# Watch mode
npm run test:watch
```

### Type-check and lint

```bash
npx tsc --noEmit
npm run lint
```

---

## Local end-to-end with SAM

```bash
# 1. Build (esbuild must be on PATH)
export PATH="$PATH:$(pwd)/node_modules/.bin"
sam build

# 2. Start all three Lambdas on localhost:3000
#    PROVIDER_REGISTRY points to host.docker.internal so the ranking container
#    can reach the mock containers through the Docker bridge network.
#    STAGE is empty so the stripStagePrefix plugin is a no-op locally.
REGISTRY='[{"provider_id":"northcare","offers_url":"http://host.docker.internal:3000/provider/northcare/offers","enabled":true},{"provider_id":"carepoint","offers_url":"http://host.docker.internal:3000/provider/carepoint/offers","enabled":true}]'

sam local start-api \
  --env-vars <(echo "{
    \"RankingFunction\":{\"PROVIDER_REGISTRY\":\"$REGISTRY\",\"STAGE\":\"\"},
    \"NorthcareMockFunction\":{\"STAGE\":\"\"},
    \"CarePointMockFunction\":{\"STAGE\":\"\"}
  }")

# 3. In a second terminal — verify mocks
curl -s http://localhost:3000/provider/northcare/offers | jq length   # → 5
curl -s http://localhost:3000/provider/carepoint/offers | jq length   # → 5

# 4. Test the ranking endpoint
curl -s "http://localhost:3000/best-care-options?\
service_code=MRI_BRAIN&city=Yerevan&patient_currency=AMD&\
max_distance_km=15&max_wait_hours=72&insurance_plan=MedPrime" | jq .
```

Expected result: `NC-1001` rank 1, `CP-2001` rank 2, `CP-2002` rank 3, `NC-1005` rank 4, `NC-1002` rank 5, `CP-2004` rank 6.

---

## Deploying to AWS

### 1. Create the OIDC identity provider (one-time per AWS account)

```bash
aws iam create-open-id-connect-provider \
  --url "https://token.actions.githubusercontent.com" \
  --client-id-list "sts.amazonaws.com" \
  --thumbprint-list "$(openssl s_client -servername token.actions.githubusercontent.com \
      -showcerts -connect token.actions.githubusercontent.com:443 < /dev/null 2>/dev/null \
      | openssl x509 -fingerprint -sha1 -noout 2>/dev/null \
      | sed 's/://g' | awk -F= '{print tolower($2)}')"
```

### 2. Create the deploy IAM role

Replace `YOUR_ACCOUNT_ID`, `YOUR_ORG`, and `YOUR_REPO` throughout.

**Trust policy** — save to `/tmp/trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_ORG/YOUR_REPO:*"
        }
      }
    }
  ]
}
```

> **Note:** GitHub repos created after July 2026 use immutable subject claims.
> If the OIDC handshake fails, retrieve your numeric owner and repo IDs and use:
> `"repo:YOUR_ORG@OWNER_ID/YOUR_REPO@REPO_ID:*"`

```bash
aws iam create-role \
  --role-name med-nexa-health-github-deploy \
  --assume-role-policy-document file:///tmp/trust-policy.json
```

**Permissions policy** — save to `/tmp/deploy-policy.json` (replace `YOUR_ACCOUNT_ID`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormation",
      "Effect": "Allow",
      "Action": ["cloudformation:*"],
      "Resource": [
        "arn:aws:cloudformation:eu-west-1:YOUR_ACCOUNT_ID:stack/med-nexa-health-*/*",
        "arn:aws:cloudformation:eu-west-1:YOUR_ACCOUNT_ID:stack/aws-sam-cli-managed-*/*"
      ]
    },
    {
      "Sid": "CloudFormationTransform",
      "Effect": "Allow",
      "Action": ["cloudformation:CreateChangeSet"],
      "Resource": "arn:aws:cloudformation:eu-west-1:aws:transform/*"
    },
    {
      "Sid": "S3ForSAMArtifacts",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicy",
        "s3:PutBucketPolicy",
        "s3:DeleteBucketPolicy",
        "s3:GetBucketAcl",
        "s3:PutBucketAcl",
        "s3:PutBucketVersioning",
        "s3:GetBucketVersioning",
        "s3:GetEncryptionConfiguration",
        "s3:PutEncryptionConfiguration",
        "s3:GetBucketPublicAccessBlock",
        "s3:PutBucketPublicAccessBlock",
        "s3:GetBucketTagging",
        "s3:PutBucketTagging",
        "s3:TagResource",
        "s3:UntagResource"
      ],
      "Resource": ["arn:aws:s3:::aws-sam-cli-managed-*", "arn:aws:s3:::aws-sam-cli-managed-*/*"]
    },
    {
      "Sid": "Lambda",
      "Effect": "Allow",
      "Action": ["lambda:*"],
      "Resource": "arn:aws:lambda:eu-west-1:YOUR_ACCOUNT_ID:function:med-nexa-*"
    },
    {
      "Sid": "ApiGateway",
      "Effect": "Allow",
      "Action": ["apigateway:*"],
      "Resource": "*"
    },
    {
      "Sid": "IAMRoleManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:GetRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:GetRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy"
      ],
      "Resource": "arn:aws:iam::YOUR_ACCOUNT_ID:role/med-nexa-health-*"
    },
    {
      "Sid": "IAMPassRoleToLambdaOnly",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::YOUR_ACCOUNT_ID:role/med-nexa-health-*",
      "Condition": {
        "StringEquals": { "iam:PassedToService": "lambda.amazonaws.com" }
      }
    }
  ]
}
```

```bash
aws iam put-role-policy \
  --role-name med-nexa-health-github-deploy \
  --policy-name med-nexa-health-deploy-policy \
  --policy-document file:///tmp/deploy-policy.json
```

### 3. Configure GitHub repository

**Secret** (Settings → Secrets → Actions):

| Name                  | Value                                                             |
| --------------------- | ----------------------------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::YOUR_ACCOUNT_ID:role/med-nexa-health-github-deploy` |

**Variables** (Settings → Variables → Actions):

| Name                | Example value                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `AWS_REGION`        | `eu-west-1`                                                                                                                         |
| `SAM_STACK_NAME`    | `med-nexa-health-dev`                                                                                                               |
| `PROVIDER_REGISTRY` | `[{"provider_id":"northcare","offers_url":"https://...","enabled":true},...]`                                                       |
| `FX_RATES`          | `{"AMD":{"USD":0.00261,"AMD":1,"EUR":0.00238},"USD":{"AMD":383.14,"USD":1,"EUR":0.00912},"EUR":{"AMD":420.0,"USD":1.0965,"EUR":1}}` |

Also create a GitHub **Environment** named `dev` (Settings → Environments).

### 4. First deploy — bootstrap

The first deploy is a two-pass bootstrap because `PROVIDER_REGISTRY` needs the
deployed Lambda URLs, which don't exist yet:

**Pass 1:** Set `PROVIDER_REGISTRY` to placeholder values and push to `main`.
The smoke test will fail but the stack and URLs are created.

After the deploy job runs, open the **"Print deployed endpoint URLs"** step in
GitHub Actions — it prints a summary table with the real URLs.

**Pass 2:** Update `PROVIDER_REGISTRY` with the real mock URLs, then re-run the
workflow. The smoke test passes.

### 5. Subsequent deploys

Push to `main` — the pipeline runs automatically:

```
lint → type-check → test (85% coverage gate) → SAM build → SAM deploy → smoke test
```

PRs run lint + test only — no deploy.

---

## CI/CD pipeline

The workflow (`.github/workflows/deploy.yml`) has two jobs:

**`lint-and-test`** — runs on every push and PR:

- `npx tsc --noEmit`
- `npm run lint`
- `npm run test:coverage` (fails if coverage drops below 85%)
- Uploads coverage report as an artifact (30-day retention)

**`deploy`** — runs on push to `main` only, after `lint-and-test` passes:

- Assumes `med-nexa-health-github-deploy` via OIDC (no stored AWS credentials)
- `sam build --parallel` (esbuild bundles each Lambda to CJS)
- `sam deploy` with CloudFormation parameters for scalars
- `aws lambda update-function-configuration` to inject `PROVIDER_REGISTRY` and
  `FX_RATES` as JSON env vars directly (bypasses CloudFormation parameter quoting issues)
- Prints deployed URLs to the job summary
- Smoke tests `GET /best-care-options` — expects HTTP 200

Concurrency is serialised on `main` to prevent racing deploys.

---

## API reference

### `GET /config/options`

Returns unique, sorted filter option values derived dynamically from all enabled providers' offers. Used by the [MedNexa UI](../med-nexa-ui) to populate dropdown menus.

**No query parameters.**

**Example request:**

```bash
curl -s "https://<api-id>.execute-api.eu-west-1.amazonaws.com/dev/config/options" | jq .
```

**Example response:**

```json
{
  "service_codes": ["CT_CHEST", "MRI_BRAIN"],
  "cities": ["Gyumri", "Vanadzor", "Yerevan"],
  "currencies": ["AMD", "EUR", "USD"],
  "insurance_plans": ["CarePlus", "MedPrime", "SilverShield"]
}
```

All arrays are alphabetically sorted and deduplicated. Values are derived from the live offer data — adding a new provider automatically adds its service codes, cities, currencies, and insurance plans to the response.

If all providers are unavailable, all arrays are empty:

```json
{ "service_codes": [], "cities": [], "currencies": [], "insurance_plans": [] }
```

---

### `GET /best-care-options`

Returns a ranked list of healthcare appointment offers matching the patient's criteria.

**Query parameters:**

| Parameter          | Type             | Required | Description                                                   |
| ------------------ | ---------------- | -------- | ------------------------------------------------------------- |
| `service_code`     | string           | Yes      | Medical service code, e.g. `MRI_BRAIN`                        |
| `city`             | string           | Yes      | City to search in, e.g. `Yerevan`                             |
| `patient_currency` | string (3 chars) | Yes      | ISO 4217 currency code, e.g. `AMD`                            |
| `max_distance_km`  | number           | Yes      | Maximum distance in km (inclusive)                            |
| `max_wait_hours`   | number           | Yes      | Maximum wait time in hours (inclusive)                        |
| `insurance_plan`   | string           | No       | Insurance plan name for discount eligibility (case-sensitive) |

**Example request:**

```bash
curl -s "https://<api-id>.execute-api.eu-west-1.amazonaws.com/dev/best-care-options?\
service_code=MRI_BRAIN&city=Yerevan&patient_currency=AMD&\
max_distance_km=15&max_wait_hours=72&insurance_plan=MedPrime" | jq .
```

**Example response:**

> With the default mock data and EUR support in `FX_RATES`, this query matches 6 offers.
> NC-1003/NC-1004/CP-2003/CP-2005 are filtered out by service_code, city, or distance/wait constraints.

```json
{
  "request_id": "a3f1c2d4-1234-4abc-8def-000000000001",
  "service_code": "MRI_BRAIN",
  "city": "Yerevan",
  "patient_currency": "AMD",
  "results": [
    {
      "rank": 1,
      "offer_id": "NC-1001",
      "provider_id": "northcare",
      "effective_price": 80750,
      "wait_hours": 20,
      "distance_km": 3.2,
      "quality_score": 88,
      "value_score": 33.481,
      "reason_code": "TOP_VALUE_SCORE",
      "reason": "Best overall value: quality 88, wait 20 h, distance 3.2 km, insurance discount applied"
    },
    {
      "rank": 2,
      "offer_id": "CP-2001",
      "provider_id": "carepoint",
      "effective_price": 77350,
      "wait_hours": 22,
      "distance_km": 4,
      "quality_score": 86,
      "value_score": 32.686,
      "reason_code": "TOP_VALUE_SCORE",
      "reason": "Best overall value: quality 86, wait 22 h, distance 4 km, insurance discount applied"
    },
    {
      "rank": 3,
      "offer_id": "CP-2002",
      "provider_id": "carepoint",
      "effective_price": 88200,
      "wait_hours": 34,
      "distance_km": 5.6,
      "quality_score": 92,
      "value_score": 24.5,
      "reason_code": "BEST_QUALITY",
      "reason": "High quality score: 92 with wait 34 h and distance 5.6 km"
    },
    {
      "rank": 4,
      "offer_id": "NC-1005",
      "provider_id": "northcare",
      "effective_price": 88122,
      "wait_hours": 28,
      "distance_km": 11.9,
      "quality_score": 90,
      "value_score": 19.317,
      "reason_code": "BEST_QUALITY",
      "reason": "High quality score: 90 with wait 28 h and distance 11.9 km"
    },
    {
      "rank": 5,
      "offer_id": "NC-1002",
      "provider_id": "northcare",
      "effective_price": 87000,
      "wait_hours": 36,
      "distance_km": 8.4,
      "quality_score": 84,
      "value_score": 17.6,
      "reason_code": "TOP_VALUE_SCORE",
      "reason": "Best overall value: quality 84, wait 36 h, distance 8.4 km"
    },
    {
      "rank": 6,
      "offer_id": "CP-2004",
      "provider_id": "carepoint",
      "effective_price": 99000,
      "wait_hours": 12,
      "distance_km": 9.9,
      "quality_score": 80,
      "value_score": 16.43,
      "reason_code": "SHORTEST_WAIT",
      "reason": "Shortest wait: 12 h with quality 80 and distance 9.9 km"
    }
  ]
}
```

**`reason_code` values:**

| Code               | Meaning                                                        |
| ------------------ | -------------------------------------------------------------- |
| `TOP_VALUE_SCORE`  | Best composite score across quality, wait, distance, and price |
| `BEST_QUALITY`     | Quality score is the dominant contributor                      |
| `SHORTEST_WAIT`    | Wait time is the dominant contributor                          |
| `CLOSEST_DISTANCE` | Distance is the dominant contributor                           |
| `BEST_PRICE`       | Low effective price drives the score                           |

**Error responses:**

| Status | `error`           | Cause                                          |
| ------ | ----------------- | ---------------------------------------------- |
| `400`  | `INVALID_REQUEST` | Missing or invalid query parameter             |
| `500`  | `INTERNAL_ERROR`  | Unexpected server error — no internals exposed |

---

## Adding a new provider

### Production (zero code change)

Update `PROVIDER_REGISTRY` in GitHub Variables to include the new provider and push to `main`:

```json
[
  { "provider_id": "northcare", "offers_url": "https://...", "enabled": true },
  { "provider_id": "carepoint", "offers_url": "https://...", "enabled": true },
  { "provider_id": "westmed", "offers_url": "https://...", "enabled": true }
]
```

The ranking service code never changes. No SAM redeploy needed — the pipeline's
post-deploy `aws lambda update-function-configuration` step injects the updated
registry directly.

### Dev / mock (3 steps)

**1.** Add `src/mocks/westmed.ts`:

```typescript
import { createMockHandler } from './factory'
import type { Offer } from '../ranking/types'

const WESTMED_OFFERS: Offer[] = [
  // your sample offer data
]

export const handler = createMockHandler(WESTMED_OFFERS, '/provider/westmed/offers')
```

**2.** Add a function entry in `template.yaml` (copy `NorthcareMockFunction`, update names,
handler, path, and entry point to `src/mocks/westmed.ts`).

**3.** Update `PROVIDER_REGISTRY` to include the new mock URL and push to `main`.

---

## Test coverage

194 tests across 9 test files — unit + integration.
Coverage gate: **85% lines / branches / functions / statements**.

```
All files            | Statements | Branches | Functions | Lines
---------------------|------------|----------|-----------|------
ranking/service/     |    96.55%  |  93.57%  |  96.87%   | 96.55%
  aggregator.ts      |    94.59%  |  82.60%  |  83.33%   | 97.14%
  deduplicator.ts    |   100.00%  | 100.00%  | 100.00%   | 100.00%
  filter.ts          |   100.00%  | 100.00%  | 100.00%   | 100.00%
  fx.ts              |   100.00%  | 100.00%  | 100.00%   | 100.00%
  ranker.ts          |    83.87%  |  63.63%  | 100.00%   | 82.75%
  registry.ts        |   100.00%  | 100.00%  | 100.00%   | 100.00%
  scorer.ts          |   100.00%  | 100.00%  | 100.00%   | 100.00%
```

---

## Security notes

- No secrets hardcoded anywhere — all configuration via environment variables
- AWS authentication uses OIDC — no long-lived access keys stored in GitHub
- IAM deploy role is scoped to `med-nexa-health-*` resources with `iam:PassRole` restricted to `lambda.amazonaws.com`
- Input validation via Fastify JSON Schema rejects malformed requests before they reach service logic
- Error responses never expose stack traces, file paths, or internal details
- Structured logs never include PII, tokens, or payment data
- All dependencies pinned to exact versions

> Per team policy, all security-critical code (input validation, auth, error handling)
> requires human review before merge.
