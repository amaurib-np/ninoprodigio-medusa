import {
  Body,
  Container,
  Heading,
  Hr,
  Html,
  Row,
  Column,
  Section,
  Text,
} from "@react-email/components"

type OrderItem = {
  title: string
  quantity: number
  unit_price: number
  total?: number
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
    total?: number
    items?: OrderItem[]
    shipping_address?: OrderAddress | null
  }
}

function formatAmount(amount: number | undefined, currency: string | undefined): string {
  if (typeof amount !== "number") {
    return ""
  }
  const code = (currency || "usd").toUpperCase()
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
  }).format(amount / 100)
}

export function orderPlacedEmail(props: OrderPlacedEmailProps) {
  const { order } = props
  const items = order.items ?? []

  return (
    <Html>
      <Body style={{ fontFamily: "Helvetica, Arial, sans-serif", backgroundColor: "#f6f6f6" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "8px" }}>
          <Heading as="h1" style={{ fontSize: "20px" }}>
            Thank you for your order
          </Heading>
          <Text>
            We&apos;ve received your order{order.display_id ? ` #${order.display_id}` : ""} and are
            getting it ready. You&apos;ll get another email once it ships.
          </Text>
          <Hr />
          <Section>
            {items.map((item, index) => (
              <Row key={index} style={{ marginBottom: "8px" }}>
                <Column>
                  <Text style={{ margin: 0 }}>
                    {item.title} &times; {item.quantity}
                  </Text>
                </Column>
                <Column align="right">
                  <Text style={{ margin: 0 }}>
                    {formatAmount(item.total ?? item.unit_price * item.quantity, order.currency_code)}
                  </Text>
                </Column>
              </Row>
            ))}
          </Section>
          <Hr />
          <Row>
            <Column>
              <Text style={{ fontWeight: "bold", margin: 0 }}>Total</Text>
            </Column>
            <Column align="right">
              <Text style={{ fontWeight: "bold", margin: 0 }}>
                {formatAmount(order.total, order.currency_code)}
              </Text>
            </Column>
          </Row>
          {order.shipping_address ? (
            <>
              <Hr />
              <Text style={{ fontWeight: "bold", marginBottom: "4px" }}>Shipping to</Text>
              <Text style={{ margin: 0 }}>
                {order.shipping_address.first_name} {order.shipping_address.last_name}
              </Text>
              <Text style={{ margin: 0 }}>{order.shipping_address.address_1}</Text>
              <Text style={{ margin: 0 }}>
                {order.shipping_address.city} {order.shipping_address.province}{" "}
                {order.shipping_address.postal_code}
              </Text>
            </>
          ) : null}
        </Container>
      </Body>
    </Html>
  )
}

export default orderPlacedEmail
