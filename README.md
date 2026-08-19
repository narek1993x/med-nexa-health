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
API Gateway (HTTP API)
  │
  ▼
Ranking Lambda (TypeScript / Fastify)
  ├── reads PROVIDER_REGISTRY env var at cold start
  ├── fetches all providers in parallel (Promise.allSettled)
  │     ├── NorthCare Mock Lambda  →  GET /provider/northcare/offers
  │     └── CarePoint Mock Lambda  →  GET /provider/carepoint/offers
  │
  ├── filter by service_code + city
  ├── filter by max_distance_km + max_wait_hours
  ├── FX convert prices to patient_currency
  ├── compute effective_price (insurance discount)
  ├── compute wait_score, distance_score, value_score
  ├── deduplicate by (service_code, city, earliest_slot_utc) → keep highest value_score
  ├── sort by value_score desc, effective_price asc
  └── assign rank + reason_code + reason
  │
  ▼
Structured JSON logs → CloudWatch Logs
```

### Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Cloud provider | AWS | Lambda + API Gateway + CloudWatch — serverless, scales to zero, low ops |
| Runtime | TypeScript / Node.js 20.x | Strong typing, fast cold starts, native `fetch` built in |
| Framework | Fastify 5 | Built-in JSON Schema validation, lowest Lambda overhead, 2–3× faster than Express |
| IaC | AWS SAM | Purpose-built for Lambda + API Gateway, esbuild bundler built in |
| CI/CD auth | OIDC (no stored keys) | Role assumption via GitHub OIDC provider — no long-lived credentials |
| Provider discovery | `PROVIDER_REGISTRY` env var | Zero-code provider onboarding — update env var, no redeploy needed |
| FX conversion | Static in-memory table | No external dependency, no latency, overridable via `FX_RATES` env var |
| Resilience | `Promise.allSettled` | One provider down never fails the request |

---

## Ranking pipeline

The `value_score` formula (from spec):

```
effective_price = converted_price × 0.85   (if insurance_plan matches)
                | converted_price           (otherwise)

wait_score     = max(0, 1 − wait_hours / max_wait_hours)
distance_score = max(0, 1 − distance_km / max_distance_km)

value_score = (quality_score × 0.5)
            + (wait_score × 25)
            + (distance_score × 15)
            − (effective_price / 2000)
```

Deduplication: after scoring, offers sharing the same
`(service_code, city, earliest_slot_utc)` are grouped and the highest
`value_score` per slot is kept — always showing the best customer option when
the same slot is listed by multiple providers.

---

## Project structure

```
med-nexa-health/
├── src/
│   ├── ranking/
│   │   ├── handler.ts          # Lambda entrypoint (cold start init)
│   │   ├── router.ts           # GET /best-care-options route + pipeline
│   │   ├── types.ts            # Shared TypeScript interfaces
│   │   └── service/
│   │       ├── registry.ts     # PROVIDER_REGISTRY parser
│   │       ├── aggregator.ts   # Parallel provider fetch
│   │       ├── fx.ts           # Currency conversion
│   │       ├── filter.ts       # Service/city + distance/wait filters
│   │       ├── scorer.ts       # value_score formula
│   │       ├── deduplicator.ts # Slot-level deduplication
│   │       └── ranker.ts       # Sort + rank + reason generation
│   └── mocks/
│       ├── factory.ts          # Shared mock handler factory
│       ├── northcare.ts        # NorthCare mock Lambda
│       └── carepoint.ts        # CarePoint mock Lambda
├── tests/
│   ├── unit/                   # Pure function unit tests
│   └── integration/            # Full pipeline integration tests (Fastify inject)
├── template.yaml               # AWS SAM template
├── samconfig.toml              # SAM deploy configuration
└── .github/workflows/
    └── deploy.yml              # CI/CD pipeline
```

---

## Local development

### Prerequisites

- Node.js 20+ (22 recommended)
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- [Docker](https://docs.docker.com/get-docker/) (for `sam local`)
- AWS CLI configured with credentials for your dev account

### Install dependencies

```bash
npm install
```

### Run tests

```bash
# All tests (unit + integration)
npm test

# With coverage report (must be ≥ 85%)
npm run test:coverage

# Watch mode during development
npm run test:watch
```

### Type-check

```bash
npx tsc --noEmit
```

### Lint

```bash
npm run lint
```

### Build (TypeScript compile + esbuild bundle)

```bash
npm run build
```

---

## Local end-to-end with SAM

Build and start all three Lambda functions locally:

```bash
sam build

# Start API Gateway + all three Lambdas on localhost:3000
sam local start-api
```

In a second terminal, test the mock providers:

```bash
curl http://localhost:3000/provider/northcare/offers | jq .
curl http://localhost:3000/provider/carepoint/offers | jq .
```

Test the ranking endpoint (update `PROVIDER_REGISTRY` to point to localhost first):

```bash
# Set the registry to local mock URLs
export PROVIDER_REGISTRY='[
  {"provider_id":"northcare","offers_url":"http://host.docker.internal:3000/provider/northcare/offers","enabled":true},
  {"provider_id":"carepoint","offers_url":"http://host.docker.internal:3000/provider/carepoint/offers","enabled":true}
]'

sam local start-api --env-vars <(echo "{\"RankingFunction\":{\"PROVIDER_REGISTRY\":$PROVIDER_REGISTRY}}")
```

Then:

```bash
curl -s "http://localhost:3000/best-care-options?\
service_code=MRI_BRAIN&\
city=Yerevan&\
patient_currency=AMD&\
max_distance_km=15&\
max_wait_hours=72&\
insurance_plan=MedPrime" | jq .
```

Expected top result: `NC-1001` (NorthCare, AMD 95000 → 80750 after MedPrime discount).

---

## Deploying to AWS

### 1. Set up OIDC trust (one-time)

Create an IAM OIDC provider for GitHub Actions and an IAM role with the following
trust policy (replace `YOUR_GITHUB_ORG/YOUR_REPO`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_ORG/YOUR_REPO:*"
      }
    }
  }]
}
```

Attach a policy granting the role permissions for:
`cloudformation:*`, `lambda:*`, `apigateway:*`, `s3:*`, `iam:PassRole`, `iam:CreateRole`,
`iam:AttachRolePolicy`, `iam:DetachRolePolicy`, `iam:DeleteRole`

### 2. Configure GitHub repository settings

**Secrets** (Settings → Secrets → Actions):

| Secret | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | ARN of the IAM role created above |

**Variables** (Settings → Variables → Actions):

| Variable | Example value |
|---|---|
| `AWS_REGION` | `eu-west-1` |
| `SAM_STACK_NAME` | `med-nexa-health-dev` |
| `PROVIDER_REGISTRY` | `[{"provider_id":"northcare","offers_url":"https://...","enabled":true},...]` |
| `FX_RATES` | `{"AMD":{"USD":0.00261,"AMD":1},"USD":{"AMD":383.14,"USD":1}}` |

> **Note on `PROVIDER_REGISTRY`:** After the first deploy, retrieve the mock Lambda
> URLs from CloudFormation stack outputs and update this variable. Subsequent deploys
> will use the live URLs.

### 3. Deploy manually (first time)

```bash
# Build
sam build

# Deploy (uses samconfig.toml defaults)
sam deploy --guided
```

Or deploy directly:

```bash
sam deploy \
  --stack-name med-nexa-health-dev \
  --region eu-west-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "Environment=dev" \
    "LogLevel=info" \
    "ProviderRegistry=<your-registry-json>" \
    "FxRates=<your-fx-json>"
```

### 4. Subsequent deploys

Push to `main` — GitHub Actions handles lint → test → build → deploy automatically.

---

## API reference

### `GET /best-care-options`

Returns a ranked list of healthcare appointment offers matching the patient's criteria.

**Query parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `service_code` | string | Yes | Medical service code (e.g. `MRI_BRAIN`) |
| `city` | string | Yes | City to search in (e.g. `Yerevan`) |
| `patient_currency` | string (3 chars) | Yes | ISO 4217 currency code (e.g. `AMD`) |
| `max_distance_km` | number | Yes | Maximum acceptable distance in km |
| `max_wait_hours` | number | Yes | Maximum acceptable wait time in hours |
| `insurance_plan` | string | No | Insurance plan name for discount eligibility |

**Example request:**

```bash
curl -s "https://<api-id>.execute-api.eu-west-1.amazonaws.com/dev/best-care-options?\
service_code=MRI_BRAIN&\
city=Yerevan&\
patient_currency=AMD&\
max_distance_km=15&\
max_wait_hours=72&\
insurance_plan=MedPrime" | jq .
```

**Example response:**

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
      "offer_id": "NC-1005",
      "provider_id": "northcare",
      "effective_price": 88122.2,
      "wait_hours": 28,
      "distance_km": 11.9,
      "quality_score": 90,
      "value_score": 19.317,
      "reason_code": "BEST_QUALITY",
      "reason": "High quality score: 90 with wait 28 h and distance 11.9 km"
    }
  ]
}
```

**`reason_code` values:**

| Code | Meaning |
|---|---|
| `TOP_VALUE_SCORE` | Balanced across quality, wait, distance — best overall composite score |
| `BEST_QUALITY` | Quality score is the dominant contributor |
| `SHORTEST_WAIT` | Wait time is the dominant contributor |
| `CLOSEST_DISTANCE` | Distance is the dominant contributor |
| `BEST_PRICE` | Very low price drives the score |

**Error responses:**

| Status | `error` | Cause |
|---|---|---|
| `400` | `INVALID_REQUEST` | Missing or invalid query parameter |
| `500` | `INTERNAL_ERROR` | Unexpected server error (no internals exposed) |

---

## Adding a new provider

### Production (zero code change)

Update the `PROVIDER_REGISTRY` GitHub variable to include the new provider:

```json
[
  {"provider_id": "northcare",  "offers_url": "https://...", "enabled": true},
  {"provider_id": "carepoint",  "offers_url": "https://...", "enabled": true},
  {"provider_id": "westmed",    "offers_url": "https://...", "enabled": true}
]
```

Push to `main` → GitHub Actions redeploys with the new registry. The ranking service
code is unchanged.

### Dev / mock (minimal code)

1. Add `src/mocks/westmed.ts` (~5 lines using the factory):

```typescript
import { createMockHandler } from './factory.js'
import type { Offer } from '../ranking/types.js'

const WESTMED_OFFERS: Offer[] = [/* your sample data */]

export const handler = createMockHandler(WESTMED_OFFERS)
```

2. Add one SAM function entry in `template.yaml` (copy `NorthcareMockFunction`, change names).

3. Update `PROVIDER_REGISTRY` to include the new mock URL.

---

## Test coverage

```
All files         |   87.76 |    85.84 |   88.57 |   87.77
 ranking/service  |   95.20 |    88.23 |   96.55 |   95.65
  aggregator.ts   |   94.59 |    82.60 |   83.33 |   97.14
  deduplicator.ts |  100.00 |   100.00 |  100.00 |  100.00
  filter.ts       |  100.00 |   100.00 |  100.00 |  100.00
  fx.ts           |  100.00 |   100.00 |  100.00 |  100.00
  ranker.ts       |   83.87 |    63.63 |  100.00 |   82.75
  registry.ts     |  100.00 |   100.00 |  100.00 |  100.00
  scorer.ts       |  100.00 |   100.00 |  100.00 |  100.00
```

189 tests total across 9 test files (unit + integration).
Threshold: 85% lines / branches / functions / statements — all passing.

---

## Security notes

- No secrets are hardcoded anywhere. All configuration is via environment variables.
- AWS authentication uses OIDC — no long-lived access keys stored in GitHub.
- Input validation rejects malformed requests before they reach service logic.
- Error responses never expose stack traces, file paths, or internal details.
- All dependencies are pinned to exact versions (`0` vulnerabilities at time of writing).
- Structured logs never include PII, payment data, or tokens.

> All security-critical code (input validation, auth, error handling) requires
> human review before merge per team SECURITY_AI_PRACTICES policy.
