/**
 * CarePoint mock provider Lambda.
 *
 * Serves the exact sample payload from the MedNexa Health spec.
 * Deployed at: GET /provider/carepoint/offers
 */

import { createMockHandler } from './factory'
import type { Offer } from '../ranking/types'

const CAREPOINT_OFFERS: Offer[] = [
  {
    offer_id: 'CP-2001',
    provider_id: 'carepoint',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 91000,
    earliest_slot_utc: '2026-09-02T10:30:00Z',
    wait_hours: 22,
    distance_km: 4.0,
    quality_score: 86,
    insurance_plans: ['MedPrime', 'CarePlus'],
  },
  {
    offer_id: 'CP-2002',
    provider_id: 'carepoint',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'EUR',
    price_amount: 210,
    earliest_slot_utc: '2026-09-03T09:15:00Z',
    wait_hours: 34,
    distance_km: 5.6,
    quality_score: 92,
    insurance_plans: ['CarePlus'],
  },
  {
    offer_id: 'CP-2003',
    provider_id: 'carepoint',
    service_code: 'CT_CHEST',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 49000,
    earliest_slot_utc: '2026-09-02T12:00:00Z',
    wait_hours: 25,
    distance_km: 7.3,
    quality_score: 83,
    insurance_plans: ['MedPrime', 'SilverShield'],
  },
  {
    offer_id: 'CP-2004',
    provider_id: 'carepoint',
    service_code: 'MRI_BRAIN',
    city: 'Yerevan',
    currency: 'AMD',
    price_amount: 99000,
    earliest_slot_utc: '2026-09-02T06:45:00Z',
    wait_hours: 12,
    distance_km: 9.9,
    quality_score: 80,
    insurance_plans: ['SilverShield'],
  },
  {
    offer_id: 'CP-2005',
    provider_id: 'carepoint',
    service_code: 'MRI_BRAIN',
    city: 'Vanadzor',
    currency: 'AMD',
    price_amount: 76000,
    earliest_slot_utc: '2026-09-05T11:00:00Z',
    wait_hours: 60,
    distance_km: 3.5,
    quality_score: 78,
    insurance_plans: ['CarePlus'],
  },
]

export const handler = createMockHandler(CAREPOINT_OFFERS)
