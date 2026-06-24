/**
 * Strict types for the slice of the Shopify Admin GraphQL API the importer
 * reads. Only the fields the import needs are modeled (no `any`).
 */

export type ShopifyWeightUnit = "GRAMS" | "KILOGRAMS" | "OUNCES" | "POUNDS"

export type ShopifyMoney = string // major units, e.g. "12.99"

export type ShopifyImage = {
  id: string
  url: string
  altText: string | null
}

export type ShopifyVariant = {
  id: string
  title: string
  sku: string | null
  barcode: string | null
  price: ShopifyMoney
  selectedOptions: { name: string; value: string }[]
  inventoryQuantity: number | null
  inventoryItem: {
    id: string
    tracked: boolean
    measurement: {
      weight: { value: number; unit: ShopifyWeightUnit } | null
    } | null
  } | null
}

export type ShopifyProduct = {
  id: string
  handle: string
  title: string
  descriptionHtml: string | null
  productType: string | null
  vendor: string | null
  status: string
  tags: string[]
  featuredImage: { id: string; url: string } | null
  images: { nodes: ShopifyImage[] }
  options: { name: string; optionValues: { name: string }[] }[]
  collections: { nodes: { handle: string; title: string }[] }
  variants: { nodes: ShopifyVariant[] }
}

export type ShopifyPageInfo = {
  hasNextPage: boolean
  endCursor: string | null
}

export type ShopifyShop = {
  currencyCode: string
  name: string
}
