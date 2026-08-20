/**
 * MedCenter mock provider Lambda.
 *
 * Deliberately includes duplicate slots to exercise the deduplication pipeline:
 *
 *   MC-3001 — same slot as NC-1001 (2026-09-02T09:00:00Z), lower value_score → dropped
 *   MC-3002 — same slot as CP-2001 (2026-09-02T10:30:00Z), lower value_score → dropped
 *   MC-3003 — unique slot, passes all filters → ranked
 *   MC-3004 — unique slot, wins its own group → ranked
 *   MC-3005 — wrong city (Gyumri) → filtered out before scoring
 *
 * Deployed at: GET /provider/medcenter/offers
 */

import { createMockHandler } from './factory'
import type { Offer } from '../ranking/types'

export const MEDCENTER_OFFERS: Offer[] = [
  {
    // Duplicate of NC-1001 slot — lower quality (82 vs 88), higher price → lower value_score → dropped
    offer_id: 'MC-3001',
    provider_id: 'medcenter',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 98000,
    earliest_slot_utc: '2026-09-02T09:00:00Z',
    wait_hours: 20,
    distance_km: 6.5,
    quality_score: 82,
    insurance_plans: ['MedPrime'],
  },
  {
    // Duplicate of CP-2001 slot — lower quality (80 vs 86), worse distance → lower value_score → dropped
    offer_id: 'MC-3002',
    provider_id: 'medcenter',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 93000,
    earliest_slot_utc: '2026-09-02T10:30:00Z',
    wait_hours: 22,
    distance_km: 10.1,
    quality_score: 80,
    insurance_plans: ['MedPrime', 'SilverShield'],
  },
  {
    // Unique slot — passes all filters, ranked normally
    offer_id: 'MC-3003',
    provider_id: 'medcenter',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 83000,
    earliest_slot_utc: '2026-09-04T08:30:00Z',
    wait_hours: 50,
    distance_km: 4.8,
    quality_score: 87,
    insurance_plans: ['MedPrime', 'CarePlus'],
  },
  {
    // Unique slot — high quality, wins its group uncontested
    offer_id: 'MC-3004',
    provider_id: 'medcenter',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'USD',
    price_amount: 205,
    earliest_slot_utc: '2026-09-05T07:00:00Z',
    wait_hours: 68,
    distance_km: 2.1,
    quality_score: 93,
    insurance_plans: ['MedPrime'],
  },
  {
    // Wrong city — filtered out before deduplication
    offer_id: 'MC-3005',
    provider_id: 'medcenter',
    service_code: 'MRI_BRAIN',
    city: 'Gyumri',
    currency: 'AMD',
    price_amount: 72000,
    earliest_slot_utc: '2026-09-06T10:00:00Z',
    wait_hours: 30,
    distance_km: 3.0,
    quality_score: 85,
    insurance_plans: ['MedPrime'],
  },
]

export const handler = createMockHandler(MEDCENTER_OFFERS, '/provider/medcenter/offers')
