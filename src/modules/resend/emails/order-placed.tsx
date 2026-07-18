import { Text, Hr, Section, Row, Column } from "@react-email/components"
import type { BigNumberInput } from "@medusajs/framework/types"
import { EmailLayout } from "./layout"

type OrderItem = {
  title: string
  quantity: BigNumberInput
  unit_price: BigNumberInput
  total?: BigNumberInput
}

type OrderAddress = {
  first_name?: string | null
  last_name?: string | null
  address_1?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
  country_code?: string | null
}

export type OrderPlacedEmailProps = {
  order: {
    display_id?: number
    email?: string
    currency_code?: string
    total?: BigNumberInput
    item_total?: BigNumberInput
    shipping_total?: BigNumberInput
    items?: OrderItem[]
    shipping_address?: OrderAddress | null
  }
}

const BRAND = {
  gold: "#C49560",
  textPrimary: "#171717",
  textMuted: "#737373",
  textSubtle: "#525252",
  border: "#E5E5E5",
  surface: "#FAFAF9",
}

/**
 * `query.graph()` returns computed money/quantity fields as `BigNumber`
 * instances (from @medusajs/framework/utils), not plain JS numbers -- and
 * they reach the email template as-is (the notification module sends the
 * pre-persist payload straight to the provider, with no JSON round-trip that
 * would otherwise coerce them). `BigNumber` implements `valueOf()`, so
 * `Number(...)` unwraps both plain numbers and `BigNumber` instances safely.
 */
function toNumber(value: BigNumberInput | undefined | null): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const num = Number(value)
  return Number.isNaN(num) ? undefined : num
}

/**
 * Medusa v2 stores order amounts as the real decimal value (321 means
 * $321.00, not cents) -- no `/100` scaling here. Numbering is pinned to
 * "es-US" (period decimal separator) to match the storefront's currency
 * helper (`src/lib/format/currency.ts` in ninoprodigio-platform).
 */
function formatAmount(amount: BigNumberInput | undefined, currency: string | undefined): string {
  const num = toNumber(amount)
  if (num === undefined) {
    return ""
  }
  const code = (currency || "usd").toUpperCase()
  return new Intl.NumberFormat("es-US", {
    style: "currency",
    currency: code,
  }).format(num)
}

export function orderPlacedEmail(props: OrderPlacedEmailProps) {
  const { order } = props
  const items = order.items ?? []
  const address = order.shipping_address

  return (
    <EmailLayout>
      <Text
        style={{
          fontSize: "20px",
          fontWeight: 700,
          color: BRAND.textPrimary,
          margin: "0 0 8px",
        }}
      >
        Gracias por tu compra
      </Text>
      <Text
        style={{
          fontSize: "14px",
          color: BRAND.textSubtle,
          lineHeight: "22px",
          margin: "0 0 24px",
        }}
      >
        Hemos recibido tu pedido
        {order.display_id ? ` #${order.display_id}` : ""} y lo estamos preparando. Te
        enviaremos otro correo en cuanto sea despachado.
      </Text>

      <Section
        style={{
          backgroundColor: BRAND.surface,
          borderRadius: "8px",
          border: `1px solid ${BRAND.border}`,
          padding: "16px 20px",
          marginBottom: "20px",
        }}
      >
        {items.map((item, index) => {
          const quantity = toNumber(item.quantity) ?? 0
          const unitPrice = toNumber(item.unit_price) ?? 0
          const lineTotal = toNumber(item.total) ?? unitPrice * quantity

          return (
            <Row key={index} style={{ marginBottom: index === items.length - 1 ? 0 : "10px" }}>
              <Column>
                <Text style={{ margin: 0, fontSize: "14px", color: BRAND.textPrimary }}>
                  {item.title}{" "}
                  <span style={{ color: BRAND.textMuted }}>&times; {quantity}</span>
                </Text>
              </Column>
              <Column align="right">
                <Text style={{ margin: 0, fontSize: "14px", color: BRAND.textPrimary }}>
                  {formatAmount(lineTotal, order.currency_code)}
                </Text>
              </Column>
            </Row>
          )
        })}
      </Section>

      <Section style={{ marginBottom: "20px" }}>
        <Row style={{ marginBottom: "6px" }}>
          <Column>
            <Text style={{ margin: 0, fontSize: "13px", color: BRAND.textMuted }}>Subtotal</Text>
          </Column>
          <Column align="right">
            <Text style={{ margin: 0, fontSize: "13px", color: BRAND.textSubtle }}>
              {formatAmount(order.item_total, order.currency_code)}
            </Text>
          </Column>
        </Row>
        <Row style={{ marginBottom: "10px" }}>
          <Column>
            <Text style={{ margin: 0, fontSize: "13px", color: BRAND.textMuted }}>Envio</Text>
          </Column>
          <Column align="right">
            <Text style={{ margin: 0, fontSize: "13px", color: BRAND.textSubtle }}>
              {formatAmount(order.shipping_total, order.currency_code)}
            </Text>
          </Column>
        </Row>
        <Hr style={{ borderColor: BRAND.border, margin: "0 0 10px" }} />
        <Row>
          <Column>
            <Text style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: BRAND.textPrimary }}>
              Total
            </Text>
          </Column>
          <Column align="right">
            <Text style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: BRAND.textPrimary }}>
              {formatAmount(order.total, order.currency_code)}
            </Text>
          </Column>
        </Row>
      </Section>

      {address ? (
        <Section
          style={{
            backgroundColor: BRAND.surface,
            borderRadius: "8px",
            border: `1px solid ${BRAND.border}`,
            padding: "16px 20px",
          }}
        >
          <Text
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: BRAND.textMuted,
              textTransform: "uppercase" as const,
              letterSpacing: "0.05em",
              margin: "0 0 8px",
            }}
          >
            Enviar a
          </Text>
          <Text style={{ margin: 0, fontSize: "14px", color: BRAND.textPrimary, lineHeight: "20px" }}>
            {address.first_name} {address.last_name}
            <br />
            {address.address_1}
            <br />
            {address.city} {address.province} {address.postal_code}
          </Text>
        </Section>
      ) : null}
    </EmailLayout>
  )
}

export default orderPlacedEmail
