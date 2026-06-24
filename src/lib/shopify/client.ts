import { MedusaError } from "@medusajs/framework/utils"
import {
  ShopifyPageInfo,
  ShopifyProduct,
  ShopifyShop,
} from "./types"

type TokenResponse = {
  access_token: string
  expires_in: number
  scope?: string
}

type GraphQLResponse<T> = {
  data?: T
  errors?: { message: string }[]
}

export type ShopifyClientConfig = {
  store: string
  clientId: string
  clientSecret: string
  apiVersion: string
}

/**
 * Reads the Shopify importer config from the environment and validates it.
 * Throws (loudly) on a missing/invalid value rather than importing garbage.
 */
export function shopifyConfigFromEnv(): ShopifyClientConfig {
  const store = process.env.SHOPIFY_STORE?.trim()
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim()
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim()
  const apiVersion = process.env.SHOPIFY_API_VERSION?.trim() || "2025-01"

  if (!store || !clientId || !clientSecret) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Missing SHOPIFY_STORE / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET in env."
    )
  }

  // OAuth + Admin API require the *.myshopify.com domain, not a custom domain.
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(store)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `SHOPIFY_STORE must be the myshopify.com domain (got "${store}"). ` +
        `Use e.g. ninoprodigio.myshopify.com, not a custom storefront domain.`
    )
  }

  return { store, clientId, clientSecret, apiVersion }
}

const PRODUCTS_QUERY = /* GraphQL */ `
  query ImportProducts($cursor: String) {
    products(first: 50, after: $cursor, query: "status:active", sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        descriptionHtml
        productType
        vendor
        status
        tags
        featuredImage { id url }
        images(first: 50) { nodes { id url altText } }
        options { name optionValues { name } }
        collections(first: 25) { nodes { handle title } }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            barcode
            price
            selectedOptions { name value }
            inventoryQuantity
            inventoryItem {
              id
              tracked
              measurement { weight { value unit } }
            }
          }
        }
      }
    }
  }
`

/**
 * Minimal typed Shopify Admin GraphQL client. Exchanges client credentials for
 * a short-lived token (cached), then runs cursor-paginated product queries.
 */
export class ShopifyClient {
  private config: ShopifyClientConfig
  private token: string | null = null
  private tokenExpiresAt = 0

  constructor(config: ShopifyClientConfig) {
    this.config = config
  }

  static fromEnv(): ShopifyClient {
    return new ShopifyClient(shopifyConfigFromEnv())
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.token && now < this.tokenExpiresAt - 60_000) {
      return this.token
    }

    const res = await fetch(
      `https://${this.config.store}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          grant_type: "client_credentials",
        }),
      }
    )

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        `Shopify token exchange failed (${res.status} ${res.statusText}): ${body}`
      )
    }

    const json = (await res.json()) as TokenResponse
    this.token = json.access_token
    this.tokenExpiresAt = now + json.expires_in * 1000
    return this.token
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<T> {
    const token = await this.getAccessToken()
    const res = await fetch(
      `https://${this.config.store}/admin/api/${this.config.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables }),
      }
    )

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Shopify GraphQL request failed (${res.status} ${res.statusText}): ${body}`
      )
    }

    const json = (await res.json()) as GraphQLResponse<T>
    if (json.errors?.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Shopify GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`
      )
    }
    if (!json.data) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Shopify GraphQL returned no data."
      )
    }
    return json.data
  }

  /** Reads shop currency + name (preflight: must be USD). */
  async fetchShop(): Promise<ShopifyShop> {
    const data = await this.graphql<{ shop: ShopifyShop }>(
      `query { shop { currencyCode name } }`
    )
    return data.shop
  }

  /**
   * Lists the distinct productType and tag values across active products, for
   * confirming which value(s) mark a product as digital before mapping.
   */
  async fetchProductTypesAndTags(): Promise<{
    productTypes: string[]
    tags: string[]
  }> {
    const productTypes = new Set<string>()
    const tags = new Set<string>()
    for await (const product of this.iterateProducts()) {
      if (product.productType) {
        productTypes.add(product.productType)
      }
      for (const tag of product.tags) {
        tags.add(tag)
      }
    }
    return {
      productTypes: [...productTypes].sort(),
      tags: [...tags].sort(),
    }
  }

  /** Fetches all active products (drains pagination). */
  async fetchProducts(): Promise<ShopifyProduct[]> {
    const all: ShopifyProduct[] = []
    for await (const product of this.iterateProducts()) {
      all.push(product)
    }
    return all
  }

  private async *iterateProducts(): AsyncGenerator<ShopifyProduct> {
    let cursor: string | null = null
    do {
      const data = await this.graphql<{
        products: { pageInfo: ShopifyPageInfo; nodes: ShopifyProduct[] }
      }>(PRODUCTS_QUERY, { cursor })
      for (const node of data.products.nodes) {
        yield node
      }
      cursor = data.products.pageInfo.hasNextPage
        ? data.products.pageInfo.endCursor
        : null
    } while (cursor)
  }
}
