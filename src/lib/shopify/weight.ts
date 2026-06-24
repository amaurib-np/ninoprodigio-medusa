import { ShopifyWeightUnit } from "./types"

const GRAMS_PER_UNIT: Record<ShopifyWeightUnit, number> = {
  GRAMS: 1,
  KILOGRAMS: 1000,
  OUNCES: 28.349523125,
  POUNDS: 453.59237,
}

/**
 * Converts a Shopify weight to grams using its declared `weightUnit`. Medusa's
 * variant `weight` is stored in grams here (the importer's canonical unit); the
 * original value/unit are kept in variant metadata for traceability. Never
 * assume grams on input — Shopify reports KILOGRAMS/OUNCES/POUNDS too.
 */
export function toGrams(
  value: number | null | undefined,
  unit: ShopifyWeightUnit | null | undefined
): number | undefined {
  if (value == null || unit == null) {
    return undefined
  }
  const factor = GRAMS_PER_UNIT[unit]
  if (factor == null) {
    return undefined
  }
  return Math.round(value * factor)
}
