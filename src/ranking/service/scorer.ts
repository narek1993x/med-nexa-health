/**
 * Scoring module — pure functions for computing offer metrics.
 *
 * Implements the exact formulas from the MedNexa Health spec:
 *
 *   effective_price = converted_price * 0.85  (insurance match)
 *                   | converted_price          (no match)
 *
 *   wait_score     = max(0, 1 - wait_hours / max_wait_hours)
 *   distance_score = max(0, 1 - distance_km / max_distance_km)
 *
 *   value_score = (quality_score * 0.5)
 *               + (wait_score * 25)
 *               + (distance_score * 15)
 *               - (effective_price / 2000)
 *
 * All functions are pure (no I/O, no side effects).
 */

/**
 * Applies the 15% insurance discount when the patient's plan is supported.
 *
 * Discount applies only when:
 *   1. insurancePlan is a non-empty string
 *   2. The offer's insurance_plans array includes that plan (case-sensitive)
 *
 * @returns discounted price (× 0.85) or original price
 */
export function computeEffectivePrice(
  convertedPrice: number,
  insurancePlan: string | undefined,
  offerPlans: string[],
): number {
  if (
    insurancePlan &&
    insurancePlan.trim().length > 0 &&
    offerPlans.includes(insurancePlan.trim())
  ) {
    return convertedPrice * 0.85
  }
  return convertedPrice
}

/**
 * Normalises wait time to a 0–1 score (higher = shorter wait = better).
 * Clamps at 0 for offers that exceed the maximum.
 */
export function computeWaitScore(waitHours: number, maxWaitHours: number): number {
  return Math.max(0, 1 - waitHours / maxWaitHours)
}

/**
 * Normalises distance to a 0–1 score (higher = closer = better).
 * Clamps at 0 for offers that exceed the maximum.
 */
export function computeDistanceScore(distanceKm: number, maxDistanceKm: number): number {
  return Math.max(0, 1 - distanceKm / maxDistanceKm)
}

/**
 * Computes the composite value score per spec formula.
 *
 * Weights:
 *   - quality_score contributes 50% (max 50 points for quality=100)
 *   - wait_score    contributes 25 points at maximum
 *   - distance_score contributes 15 points at maximum
 *   - effective_price is a cost penalty (higher price → lower score)
 *
 * Can return negative values when effective_price is very large.
 */
export function computeValueScore(
  qualityScore: number,
  waitScore: number,
  distanceScore: number,
  effectivePrice: number,
): number {
  return (
    qualityScore * 0.5 +
    waitScore * 25 +
    distanceScore * 15 -
    effectivePrice / 2000
  )
}
