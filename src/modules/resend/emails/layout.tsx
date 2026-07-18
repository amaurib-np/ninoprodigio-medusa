import { Body, Container, Section, Img, Hr, Text, Link, Html, Head } from "@react-email/components"
import type { ReactNode } from "react"

/**
 * Ported from the storefront's `src/lib/email/templates/layout.tsx` so order
 * emails sent from Medusa (via Resend) look like the portal's own
 * notifications instead of a generic transactional template. Spanish-only for
 * now -- the portal layout supports es/en, but order emails don't carry a
 * locale yet (see docs/features/ecommerce.md "Implementation status").
 */
const BRAND = {
  gold: "#C49560",
  textPrimary: "#171717",
  textMuted: "#737373",
  border: "#E5E5E5",
  surface: "#FAFAF9",
}

const STOREFRONT_URL = process.env.STOREFRONT_URL || "https://ninoprodigio.com"

interface EmailLayoutProps {
  children: ReactNode
}

export function EmailLayout({ children }: EmailLayoutProps) {
  const year = new Date().getFullYear()

  return (
    <Html lang="es">
      <Head />
      <Body
        style={{
          backgroundColor: BRAND.surface,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            padding: "40px 20px",
          }}
        >
          {/* Header */}
          <Section style={{ textAlign: "center" as const, marginBottom: "32px" }}>
            <Img
              src={`${STOREFRONT_URL}/images/logo-email.png`}
              alt="El Niño Prodigio"
              width="180"
              height="auto"
              style={{ margin: "0 auto" }}
            />
          </Section>

          {/* Content */}
          <Section
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "12px",
              border: `1px solid ${BRAND.border}`,
              padding: "32px 28px",
            }}
          >
            {children}
          </Section>

          {/* Footer */}
          <Section style={{ marginTop: "32px", textAlign: "center" as const }}>
            <Hr style={{ borderColor: BRAND.border, margin: "0 0 16px" }} />
            <Text
              style={{
                color: BRAND.textMuted,
                fontSize: "12px",
                lineHeight: "18px",
                margin: "0 0 4px",
              }}
            >
              &copy; {year}{" "}
              <Link
                href="https://ninoprodigio.com"
                style={{ color: BRAND.gold, textDecoration: "none" }}
              >
                El Nino Prodigio
              </Link>
              . Todos los derechos reservados.
            </Text>
            <Text
              style={{
                color: BRAND.textMuted,
                fontSize: "11px",
                lineHeight: "16px",
                margin: 0,
              }}
            >
              Recibiste este correo porque realizaste una compra en ninoprodigio.com.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
