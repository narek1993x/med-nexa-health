/**
 * Filter module — pure functions for narrowing the offer set.
 *
 * All functions are stateless and have no side effects.
 * They compose cleanly in the ranking pipeline.
 */

import type { Offer } from '../types'

/**
 * Keeps only offers matching the requested service code and city.
 * Comparison is case-insensitive and trims whitespace.
 */
export function filterByServiceAndCity(
  offers: Offer[],
  serviceCode: string,
  city: string,
): Offer[] {
  const normalizedCode = serviceCode.trim().toUpperCase()
  const normalizedCity = city.trim().toLowerCase()

  return offers.filter(
    (o) =>
      o?.service_code.trim().toUpperCase() === normalizedCode &&
      o?.city.trim().toLowerCase() === normalizedCity,
  )
}

/**
 * Removes offers that exceed the patient's distance or wait time limits.
 * Both bounds are inclusive (<=).
 *
 * Offers at exactly the limit are included — edge case per spec:
 * "filter out offers with distance_km > max_distance_km or wait_hours > max_wait_hours"
 */
export function filterByConstraints(
  offers: Offer[],
  maxDistanceKm: number,
  maxWaitHours: number,
): Offer[] {
  return offers.filter((o) => o.distance_km <= maxDistanceKm && o.wait_hours <= maxWaitHours)
}
