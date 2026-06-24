import {
  Body,
  Button,
  Container,
  Heading,
  Hr,
  Html,
  Section,
  Text,
} from "@react-email/components"

export type OrderShippedEmailProps = {
  order: {
    display_id?: number
    email?: string
  }
  fulfillment?: {
    tracking_numbers?: string[]
    tracking_links?: { url: string; tracking_number?: string }[]
  }
}

export function orderShippedEmail(props: OrderShippedEmailProps) {
  const { order, fulfillment } = props
  const trackingLinks = fulfillment?.tracking_links ?? []
  const trackingNumbers = fulfillment?.tracking_numbers ?? []

  return (
    <Html>
      <Body style={{ fontFamily: "Helvetica, Arial, sans-serif", backgroundColor: "#f6f6f6" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "8px" }}>
          <Heading as="h1" style={{ fontSize: "20px" }}>
            Your order is on its way
          </Heading>
          <Text>
            Good news — your order{order.display_id ? ` #${order.display_id}` : ""} has shipped.
          </Text>
          {trackingNumbers.length > 0 ? (
            <Section>
              <Hr />
              <Text style={{ fontWeight: "bold", marginBottom: "4px" }}>Tracking</Text>
              {trackingNumbers.map((tn, index) => (
                <Text key={index} style={{ margin: 0 }}>
                  {tn}
                </Text>
              ))}
            </Section>
          ) : null}
          {trackingLinks.length > 0 ? (
            <Section style={{ marginTop: "12px" }}>
              {trackingLinks.map((link, index) => (
                <Button
                  key={index}
                  href={link.url}
                  style={{
                    backgroundColor: "#111827",
                    color: "#ffffff",
                    padding: "10px 16px",
                    borderRadius: "6px",
                    textDecoration: "none",
                  }}
                >
                  Track package
                </Button>
              ))}
            </Section>
          ) : null}
        </Container>
      </Body>
    </Html>
  )
}

export default orderShippedEmail
