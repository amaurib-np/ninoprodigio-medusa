import { Text, Hr, Section, Button, Row, Column } from "@react-email/components"
import { EmailLayout } from "./layout"

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

const BRAND = {
  gold: "#C49560",
  textPrimary: "#171717",
  textMuted: "#737373",
  textSubtle: "#525252",
  border: "#E5E5E5",
  surface: "#FAFAF9",
}

export function orderShippedEmail(props: OrderShippedEmailProps) {
  const { order, fulfillment } = props
  const trackingLinks = fulfillment?.tracking_links ?? []
  const trackingNumbers = fulfillment?.tracking_numbers ?? []

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
        Tu pedido va en camino
      </Text>
      <Text
        style={{
          fontSize: "14px",
          color: BRAND.textSubtle,
          lineHeight: "22px",
          margin: "0 0 24px",
        }}
      >
        Buenas noticias: tu pedido
        {order.display_id ? ` #${order.display_id}` : ""} ha sido despachado y va en camino
        a tu direccion.
      </Text>

      {trackingNumbers.length > 0 ? (
        <Section
          style={{
            backgroundColor: BRAND.surface,
            borderRadius: "8px",
            border: `1px solid ${BRAND.border}`,
            padding: "16px 20px",
            marginBottom: "20px",
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
            Seguimiento
          </Text>
          {trackingNumbers.map((tn, index) => (
            <Row key={index}>
              <Column>
                <Text style={{ margin: 0, fontSize: "14px", color: BRAND.textPrimary }}>{tn}</Text>
              </Column>
            </Row>
          ))}
        </Section>
      ) : null}

      {trackingLinks.length > 0 ? (
        <>
          <Hr style={{ borderColor: BRAND.border, margin: "0 0 20px" }} />
          <Section style={{ textAlign: "center" as const }}>
            {trackingLinks.map((link, index) => (
              <Button
                key={index}
                href={link.url}
                style={{
                  backgroundColor: BRAND.gold,
                  color: "#FFFFFF",
                  borderRadius: "8px",
                  padding: "12px 28px",
                  fontSize: "14px",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Rastrear paquete
              </Button>
            ))}
          </Section>
        </>
      ) : null}
    </EmailLayout>
  )
}

export default orderShippedEmail
