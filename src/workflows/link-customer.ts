import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  createCustomersWorkflow,
  releaseLockStep,
  updateCartWorkflow,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"

export type LinkCustomerWorkflowInput = {
  email: string
  cart_id?: string
  first_name?: string
  last_name?: string
}

/**
 * Find-or-create a Medusa customer by email (platform join key), optionally
 * attach them to a cart so the completed order inherits `customer_id`.
 *
 * Called by `POST /store/link-customer` from the Next.js platform on a logged-in
 * user's first shop action (see docs/integration-contract.md).
 */
export const linkCustomerWorkflow = createWorkflow(
  "link-customer",
  function (input: LinkCustomerWorkflowInput) {
    const { data: customers } = useQueryGraphStep({
      entity: "customer",
      fields: ["id", "email", "first_name", "last_name"],
      filters: { email: input.email },
    }).config({ name: "find-customer-by-email" })

    const createdCustomers = when(
      { customers },
      ({ customers }) => customers.length === 0
    ).then(() => {
      return createCustomersWorkflow.runAsStep({
        input: {
          customersData: [
            {
              email: input.email,
              first_name: input.first_name,
              last_name: input.last_name,
              has_account: false,
            },
          ],
        },
      })
    })

    const customer = transform(
      { customers, createdCustomers, input },
      (data) => {
        if (data.customers.length > 0) {
          return {
            id: data.customers[0].id as string,
            email: (data.customers[0].email as string) ?? data.input.email,
          }
        }
        const created = data.createdCustomers?.[0]
        return {
          id: created!.id,
          email: created!.email ?? data.input.email,
        }
      }
    )

    when({ input }, ({ input }) => !!input.cart_id).then(() => {
      const lockKey = transform({ input }, ({ input }) => input.cart_id as string)

      acquireLockStep({
        key: lockKey,
        ttl: 30,
        timeout: 10,
      })

      updateCartWorkflow.runAsStep({
        input: transform({ input, customer }, ({ input, customer }) => ({
          id: input.cart_id as string,
          email: input.email,
          customer_id: customer.id,
        })),
      })

      releaseLockStep({ key: lockKey })
    })

    return new WorkflowResponse({ customer })
  }
)
