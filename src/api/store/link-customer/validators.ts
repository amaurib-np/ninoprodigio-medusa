import { z } from "@medusajs/framework/zod"

export const PostStoreLinkCustomerSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  cart_id: z.string().min(1).optional(),
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
})

export type PostStoreLinkCustomerSchema = z.infer<
  typeof PostStoreLinkCustomerSchema
>
