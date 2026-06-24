import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  createProductsWorkflow,
  updateProductsWorkflow,
  uploadFilesWorkflow,
  createProductCategoriesWorkflow,
  createProductTagsWorkflow,
  createInventoryLevelsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows"
import { ShopifyClient } from "../lib/shopify/client"
import { ShopifyProduct } from "../lib/shopify/types"
import { toGrams } from "../lib/shopify/weight"

export type ImportShopifyInput = {
  digitalProductTypes: string[]
  digitalTags: string[]
  excludeProductTypes: string[]
}

type ImportContext = {
  locationId: string
  salesChannelId: string
  defaultProfileId: string
  digitalProfileId: string
  digitalProductTypes: string[]
  digitalTags: string[]
  excludeProductTypes: string[]
}

type InventoryTarget = {
  inventory_item_id: string
  available: number
}

export type ImportSummary = {
  created: number
  updated: number
  skipped: number
  variants: number
  imagesUploaded: number
  inventoryLevels: number
  errors: { handle: string; message: string }[]
}

const PRICE_CURRENCY = "usd"

// --- Preflight: resolve seed-created resources and validate the source -------

const resolveImportContextStep = createStep(
  "resolve-shopify-import-context",
  async (input: ImportShopifyInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: locations } = await query.graph({
      entity: "stock_location",
      fields: ["id", "name"],
      filters: { name: "Primary Warehouse" },
    })
    const { data: channels } = await query.graph({
      entity: "sales_channel",
      fields: ["id", "name"],
      filters: { name: "Default Sales Channel" },
    })
    const { data: profiles } = await query.graph({
      entity: "shipping_profile",
      fields: ["id", "name", "type"],
    })

    const location = locations?.[0]
    const channel = channels?.[0]
    const digitalProfile = profiles?.find((p) => p.name === "Digital")
    const defaultProfile = profiles?.find((p) => p.name !== "Digital")

    const missing: string[] = []
    if (!location) missing.push('stock location "Primary Warehouse"')
    if (!channel) missing.push('sales channel "Default Sales Channel"')
    if (!digitalProfile) missing.push('shipping profile "Digital"')
    if (!defaultProfile) missing.push("a default (non-Digital) shipping profile")
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Cannot import: missing ${missing.join(", ")}. Run \`npm run seed\` first.`
      )
    }

    // Source currency must be USD; we map straight into the USD region (no FX).
    const shop = await ShopifyClient.fromEnv().fetchShop()
    if (shop.currencyCode?.toUpperCase() !== "USD") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Shopify store currency is ${shop.currencyCode}, expected USD. ` +
          `Importing into the USD region would be wrong (no FX conversion).`
      )
    }

    const context: ImportContext = {
      locationId: location!.id,
      salesChannelId: channel!.id,
      defaultProfileId: defaultProfile!.id,
      digitalProfileId: digitalProfile!.id,
      digitalProductTypes: input.digitalProductTypes.map((v) => v.toLowerCase()),
      digitalTags: input.digitalTags.map((v) => v.toLowerCase()),
      excludeProductTypes: input.excludeProductTypes.map((v) => v.toLowerCase()),
    }
    return new StepResponse(context)
  }
)

const fetchActiveShopifyProductsStep = createStep(
  "fetch-active-shopify-products",
  async () => {
    const products = await ShopifyClient.fromEnv().fetchProducts()
    return new StepResponse(products)
  }
)

// --- Helpers -----------------------------------------------------------------

function isDigital(product: ShopifyProduct, ctx: ImportContext): boolean {
  const type = product.productType?.toLowerCase() ?? ""
  if (type && ctx.digitalProductTypes.includes(type)) {
    return true
  }
  const tags = product.tags.map((t) => t.toLowerCase())
  return tags.some((t) => ctx.digitalTags.includes(t))
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
}

function guessMime(url: string, contentType: string | null): string {
  if (contentType && contentType.startsWith("image/")) {
    return contentType.split(";")[0]
  }
  const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? ""
  return MIME_BY_EXT[ext] ?? "image/jpeg"
}

function filenameFromUrl(url: string, fallback: string): string {
  const name = new URL(url).pathname.split("/").pop()
  return name && name.includes(".") ? name : `${fallback}.jpg`
}

// --- Upsert (images folded in; idempotent by handle) -------------------------

const upsertProductsStep = createStep(
  "upsert-shopify-products",
  async (
    data: { products: ShopifyProduct[]; context: ImportContext },
    { container }
  ) => {
    const { products, context } = data
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const summary: ImportSummary = {
      created: 0,
      updated: 0,
      skipped: 0,
      variants: 0,
      imagesUploaded: 0,
      inventoryLevels: 0,
      errors: [],
    }
    const inventoryTargets: InventoryTarget[] = []
    const categoryCache = new Map<string, string>()
    const tagCache = new Map<string, string>()

    // Shopify SKUs are not globally unique (e.g. "4" reused across products),
    // but Medusa enforces unique SKUs. Namespace only the duplicated ones with
    // the product handle; keep the original in variant metadata.shopify_sku.
    const skuCounts = new Map<string, number>()
    for (const p of products) {
      for (const v of p.variants.nodes) {
        const s = v.sku?.trim()
        if (s) {
          skuCounts.set(s, (skuCounts.get(s) ?? 0) + 1)
        }
      }
    }
    const resolveSku = (
      product: ShopifyProduct,
      rawSku: string | undefined
    ): string | undefined => {
      if (!rawSku) {
        return undefined
      }
      return (skuCounts.get(rawSku) ?? 0) > 1
        ? `${product.handle}-${rawSku}`
        : rawSku
    }

    const resolveTagIds = async (values: string[]): Promise<string[]> => {
      const ids: string[] = []
      for (const value of values) {
        const cached = tagCache.get(value)
        if (cached) {
          ids.push(cached)
          continue
        }
        const { data: existing } = await query.graph({
          entity: "product_tag",
          fields: ["id", "value"],
          filters: { value },
        })
        let id = existing?.[0]?.id
        if (!id) {
          const { result } = await createProductTagsWorkflow(container).run({
            input: { product_tags: [{ value }] },
          })
          id = result[0].id
        }
        tagCache.set(value, id)
        ids.push(id)
      }
      return ids
    }

    const resolveCategoryIds = async (
      product: ShopifyProduct
    ): Promise<string[]> => {
      const ids: string[] = []
      for (const col of product.collections.nodes) {
        const cached = categoryCache.get(col.handle)
        if (cached) {
          ids.push(cached)
          continue
        }
        const { data: existing } = await query.graph({
          entity: "product_category",
          fields: ["id", "handle"],
          filters: { handle: col.handle },
        })
        let id = existing?.[0]?.id
        if (!id) {
          const { result } = await createProductCategoriesWorkflow(
            container
          ).run({
            input: {
              product_categories: [
                { name: col.title, handle: col.handle, is_active: true },
              ],
            },
          })
          id = result[0].id
        }
        categoryCache.set(col.handle, id)
        ids.push(id)
      }
      return ids
    }

    for (const product of products) {
      try {
        // Skip excluded product types (e.g. membership, owned by the platform).
        const productType = product.productType?.toLowerCase() ?? ""
        if (productType && context.excludeProductTypes.includes(productType)) {
          summary.skipped++
          logger.info(
            `Skipping ${product.handle} (excluded productType "${product.productType}").`
          )
          continue
        }

        const { data: existingRows } = await query.graph({
          entity: "product",
          fields: [
            "id",
            "handle",
            "metadata",
            "images.id",
            "images.url",
            "variants.id",
            "variants.sku",
          ],
          filters: { handle: product.handle },
        })
        const existing = existingRows?.[0]

        // Image de-dup: keep already-imported Shopify image ids; only upload new.
        const prevMeta = (existing?.metadata ?? {}) as Record<string, unknown>
        const prevImageIds = Array.isArray(prevMeta.shopify_image_ids)
          ? (prevMeta.shopify_image_ids as string[])
          : []
        const prevImageUrls = (existing?.images ?? [])
          .map((i) => i?.url)
          .filter((u): u is string => Boolean(u))

        const uploadedUrls: string[] = []
        const newImageIds: string[] = []
        const toUpload = product.images.nodes.filter(
          (img) => !prevImageIds.includes(img.id)
        )
        for (const img of toUpload) {
          const res = await fetch(img.url)
          if (!res.ok) {
            logger.warn(
              `Skipping image ${img.url} for ${product.handle} (HTTP ${res.status}).`
            )
            continue
          }
          const buffer = Buffer.from(await res.arrayBuffer())
          const { result } = await uploadFilesWorkflow(container).run({
            input: {
              files: [
                {
                  filename: filenameFromUrl(img.url, product.handle),
                  mimeType: guessMime(
                    img.url,
                    res.headers.get("content-type")
                  ),
                  // Both the local and S3 file providers decode base64 first;
                  // "binary"/latin1 is misread as utf8 and corrupts the bytes.
                  content: buffer.toString("base64"),
                  access: "public",
                },
              ],
            },
          })
          uploadedUrls.push(result[0].url)
          newImageIds.push(img.id)
          summary.imagesUploaded++
        }

        const imageUrls = [...prevImageUrls, ...uploadedUrls]
        const allImageIds = [...prevImageIds, ...newImageIds]

        // Thumbnail must point at a re-uploaded File Module image (decoupled from
        // Shopify's CDN). Map Shopify's featured image to its re-uploaded URL by
        // id; fall back to the first imported image.
        const featuredId = product.featuredImage?.id
        const featuredIdx = featuredId ? allImageIds.indexOf(featuredId) : -1
        const thumbnail =
          featuredIdx >= 0 ? imageUrls[featuredIdx] : imageUrls[0]

        const digital = isDigital(product, context)
        const categoryIds = await resolveCategoryIds(product)
        const tagIds = await resolveTagIds(product.tags)

        const metadata: Record<string, unknown> = {
          ...prevMeta,
          shopify_product_id: product.id,
          shopify_handle: product.handle,
          shopify_product_type: product.productType ?? null,
          shopify_image_ids: allImageIds,
        }

        const options = product.options.map((o) => ({
          title: o.name,
          values: o.optionValues.map((v) => v.name),
        }))

        const existingVariants = existing?.variants ?? []
        const existingVariantsBySku = new Map<string, string>()
        for (const v of existingVariants) {
          if (v?.sku) {
            existingVariantsBySku.set(v.sku, v.id)
          }
        }
        // Positional fallback for idempotent re-runs when variants have no sku.
        const sameVariantCount =
          existingVariants.length === product.variants.nodes.length

        const variants = product.variants.nodes.map((v, i) => {
          const optionMap: Record<string, string> = {}
          for (const so of v.selectedOptions) {
            optionMap[so.name] = so.value
          }
          const tracked = v.inventoryItem?.tracked ?? false
          const grams = toGrams(
            v.inventoryItem?.measurement?.weight?.value,
            v.inventoryItem?.measurement?.weight?.unit
          )
          // Shopify returns "" for missing sku/barcode; empty strings collide on
          // Medusa's unique barcode/sku constraints, so normalize them to undefined.
          const rawSku = v.sku?.trim() || undefined
          const sku = resolveSku(product, rawSku)
          const barcode = v.barcode?.trim() || undefined
          const existingVariantId =
            (sku ? existingVariantsBySku.get(sku) : undefined) ??
            (sameVariantCount ? existingVariants[i]?.id : undefined)
          return {
            ...(existingVariantId ? { id: existingVariantId } : {}),
            title: v.title,
            sku,
            barcode,
            manage_inventory: tracked,
            weight: grams,
            options: optionMap,
            prices: [
              { currency_code: PRICE_CURRENCY, amount: Number(v.price) },
            ],
            metadata: {
              shopify_variant_id: v.id,
              shopify_sku: rawSku ?? null,
              shopify_weight_value:
                v.inventoryItem?.measurement?.weight?.value ?? null,
              shopify_weight_unit:
                v.inventoryItem?.measurement?.weight?.unit ?? null,
            },
          }
        })

        const base = {
          title: product.title,
          handle: product.handle,
          status: "published" as const,
          description: product.descriptionHtml ?? undefined,
          shipping_profile_id: digital
            ? context.digitalProfileId
            : context.defaultProfileId,
          images: imageUrls.map((url) => ({ url })),
          thumbnail,
          tag_ids: tagIds,
          category_ids: categoryIds,
          sales_channels: [{ id: context.salesChannelId }],
          metadata,
          variants,
        }

        let productId: string
        if (existing) {
          // Options are set on create only; re-passing them on update would try
          // to re-create existing options. Variants reference them by title.
          const { result } = await updateProductsWorkflow(container).run({
            input: { products: [{ id: existing.id, ...base }] },
          })
          productId = result[0].id
          summary.updated++
        } else {
          const { result } = await createProductsWorkflow(container).run({
            input: { products: [{ ...base, options }] },
          })
          productId = result[0].id
          summary.created++
        }
        summary.variants += variants.length

        // Map created/updated variants back to inventory items by SKU so we can
        // set levels for the tracked ones.
        const { data: savedVariants } = await query.graph({
          entity: "product_variant",
          fields: [
            "id",
            "sku",
            "manage_inventory",
            "inventory_items.inventory_item_id",
          ],
          filters: { product_id: productId },
        })
        const invItemBySku = new Map<string, string>()
        for (const sv of savedVariants ?? []) {
          const invItemId = sv?.inventory_items?.[0]?.inventory_item_id
          if (sv?.sku && invItemId) {
            invItemBySku.set(sv.sku, invItemId)
          }
        }
        for (const v of product.variants.nodes) {
          const tracked = v.inventoryItem?.tracked ?? false
          const vSku = resolveSku(product, v.sku?.trim() || undefined)
          if (!tracked || !vSku) {
            continue
          }
          const invItemId = invItemBySku.get(vSku)
          if (invItemId) {
            inventoryTargets.push({
              inventory_item_id: invItemId,
              available: v.inventoryQuantity ?? 0,
            })
          }
        }
      } catch (e) {
        const message =
          e instanceof Error
            ? e.message
            : typeof e === "object" && e !== null
              ? JSON.stringify(e)
              : String(e)
        logger.error(`Failed importing ${product.handle}: ${message}`)
        summary.errors.push({ handle: product.handle, message })
      }
    }

    return new StepResponse({ summary, inventoryTargets })
  }
)

const setInventoryLevelsStep = createStep(
  "set-shopify-inventory-levels",
  async (
    data: { context: ImportContext; inventoryTargets: InventoryTarget[] },
    { container }
  ) => {
    const { context, inventoryTargets } = data
    if (!inventoryTargets.length) {
      return new StepResponse({ inventoryLevels: 0 })
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const itemIds = inventoryTargets.map((t) => t.inventory_item_id)
    const { data: existingLevels } = await query.graph({
      entity: "inventory_level",
      fields: ["id", "inventory_item_id", "location_id"],
      filters: { inventory_item_id: itemIds, location_id: context.locationId },
    })
    const existingByItem = new Set(
      (existingLevels ?? []).map((l) => l?.inventory_item_id)
    )

    const toCreate = inventoryTargets.filter(
      (t) => !existingByItem.has(t.inventory_item_id)
    )
    const toUpdate = inventoryTargets.filter((t) =>
      existingByItem.has(t.inventory_item_id)
    )

    if (toCreate.length) {
      await createInventoryLevelsWorkflow(container).run({
        input: {
          inventory_levels: toCreate.map((t) => ({
            inventory_item_id: t.inventory_item_id,
            location_id: context.locationId,
            stocked_quantity: t.available,
          })),
        },
      })
    }
    for (const t of toUpdate) {
      await updateInventoryLevelsWorkflow(container).run({
        input: {
          updates: [
            {
              inventory_item_id: t.inventory_item_id,
              location_id: context.locationId,
              stocked_quantity: t.available,
            },
          ],
        },
      })
    }

    return new StepResponse({ inventoryLevels: inventoryTargets.length })
  }
)

export const importShopifyProductsWorkflow = createWorkflow(
  "import-shopify-products",
  (input: ImportShopifyInput) => {
    const context = resolveImportContextStep(input)
    const products = fetchActiveShopifyProductsStep()
    const upsert = upsertProductsStep({ products, context })
    const inventory = setInventoryLevelsStep({
      context,
      inventoryTargets: upsert.inventoryTargets,
    })
    return new WorkflowResponse({ upsert, inventory })
  }
)
