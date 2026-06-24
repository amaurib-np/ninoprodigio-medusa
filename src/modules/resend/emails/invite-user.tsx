import {
  Body,
  Button,
  Container,
  Heading,
  Hr,
  Html,
  Text,
} from "@react-email/components"

export type InviteUserEmailProps = {
  invite_url: string
  store_name?: string
}

export function inviteUserEmail(props: InviteUserEmailProps) {
  const { invite_url, store_name } = props
  const teamName = store_name || "the team"

  return (
    <Html>
      <Body style={{ fontFamily: "Helvetica, Arial, sans-serif", backgroundColor: "#f6f6f6" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "8px" }}>
          <Heading as="h1" style={{ fontSize: "20px" }}>
            You&apos;ve been invited to join {teamName}
          </Heading>
          <Text>
            You&apos;ve been invited to the {teamName} admin dashboard. Click the button below to
            accept the invitation and set up your account.
          </Text>
          <Button
            href={invite_url}
            style={{
              backgroundColor: "#111111",
              color: "#ffffff",
              padding: "12px 20px",
              borderRadius: "6px",
              textDecoration: "none",
              display: "inline-block",
              marginTop: "8px",
            }}
          >
            Accept invitation
          </Button>
          <Hr />
          <Text style={{ fontSize: "12px", color: "#666666" }}>
            If the button doesn&apos;t work, copy and paste this link into your browser:
          </Text>
          <Text style={{ fontSize: "12px", color: "#666666", wordBreak: "break-all" }}>
            {invite_url}
          </Text>
          <Text style={{ fontSize: "12px", color: "#666666" }}>
            If you weren&apos;t expecting this invitation, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default inviteUserEmail
