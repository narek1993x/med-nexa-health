/**
 * Config options derivation module.
 *
 * Pure function that extracts all unique filter-relevant values from an array
 * of provider offers. Used by GET /config/options to populate UI dropdown menus.
 *
 * No external dependencies — safe to unit test without any mocking.
 */

import type { Offer, ConfigOptions } from '../types'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derives unique, alphabetically-sorted config option values from a flat
 * array of provider offers.
 *
 * Extracts:
 *   - service_codes: unique Offer.service_code values
 *   - cities:        unique Offer.city values
 *   - currencies:    unique Offer.currency values
 *   - insurance_plans: union of all Offer.insurance_plans[] arrays
 *
 * @param offers - Flat array of raw provider offers (may be empty)
 * @returns ConfigOptions with all four arrays sorted alphabetically
 */
export function deriveConfigOptions(offers: Offer[]): ConfigOptions {
  const serviceCodes = new Set<string>()
  const cities = new Set<string>()
  const currencies = new Set<string>()
  const insurancePlans = new Set<string>()

  for (const offer of offers) {
    serviceCodes.add(offer.service_code)
    cities.add(offer.city)
    currencies.add(offer.currency)
    for (const plan of offer.insurance_plans) {
      insurancePlans.add(plan)
    }
  }

  return {
    service_codes: [...serviceCodes].sort(),
    cities: [...cities].sort(),
    currencies: [...currencies].sort(),
    insurance_plans: [...insurancePlans].sort(),
  }
}
