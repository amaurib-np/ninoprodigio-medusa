import {
  defineMiddlewares,
  validateAndTransformBody,
} from "@medusajs/framework/http"
import { PostStoreLinkCustomerSchema } from "./store/link-customer/validators"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/link-customer",
      method: "POST",
      middlewares: [validateAndTransformBody(PostStoreLinkCustomerSchema)],
    },
  ],
})
