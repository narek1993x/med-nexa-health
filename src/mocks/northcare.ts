/**
 * NorthCare mock provider Lambda.
 *
 * Serves the exact sample payload from the MedNexa Health spec.
 * Deployed at: GET /provider/northcare/offers
 *
 * To add a new mock provider, follow this same pattern:
 *   1. Create src/mocks/<provider_id>.ts (copy this file, change the data)
 *   2. Add a SAM function entry in template.yaml
 *   3. Update PROVIDER_REGISTRY env var — no ranking service code changes needed
 */

import { createMockHandler } from './factory'
import type { Offer } from '../ranking/types'

const NORTHCARE_OFFERS: Offer[] = [
  {
    offer_id: 'NC-1001',
    provider_id: 'northcare',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 95000,
    earliest_slot_utc: '2026-09-02T09:00:00Z',
    wait_hours: 20,
    distance_km: 3.2,
    quality_score: 88,
    insurance_plans: ['MedPrime', 'SilverShield'],
  },
  {
    offer_id: 'NC-1002',
    provider_id: 'northcare',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 87000,
    earliest_slot_utc: '2026-09-03T13:30:00Z',
    wait_hours: 36,
    distance_km: 8.4,
    quality_score: 84,
    insurance_plans: ['SilverShield'],
  },
  {
    offer_id: 'NC-1003',
    provider_id: 'northcare',
    service_code: 'CT_CHEST',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 52000,
    earliest_slot_utc: '2026-09-02T07:30:00Z',
    wait_hours: 15,
    distance_km: 6.1,
    quality_score: 81,
    insurance_plans: ['MedPrime'],
  },
  {
    offer_id: 'NC-1004',
    provider_id: 'northcare',
    service_code: 'MRI_BRAIN',
    city: 'Gyumri',
    currency: 'AMD',
    price_amount: 79000,
    earliest_slot_utc: '2026-09-04T08:00:00Z',
    wait_hours: 45,
    distance_km: 2.8,
    quality_score: 79,
    insurance_plans: ['MedPrime', 'CarePlus'],
  },
  {
    offer_id: 'NC-1005',
    provider_id: 'northcare',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'USD',
    price_amount: 230,
    earliest_slot_utc: '2026-09-02T18:15:00Z',
    wait_hours: 28,
    distance_km: 11.9,
    quality_score: 90,
    insurance_plans: [],
  },
]

export const handler = createMockHandler(NORTHCARE_OFFERS, '/provider/northcare/offers')
