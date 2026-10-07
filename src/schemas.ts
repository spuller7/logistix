import { z } from "zod";

export const ticketLineItemSchema = z.object({
  ticket_type_id: z.string().min(1),
  quantity: z.number().int().positive(),
  promo_code: z.string().min(1).optional(),
});

export const buyerSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
});

export const partialBuyerSchema = buyerSchema.partial();

export const eventSearchQuerySchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(),
  starts_after: z.string().optional(),
  starts_before: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const createCheckoutInputSchema = z.object({
  event_id: z.string().min(1),
  items: z.array(ticketLineItemSchema).min(1),
  buyer: partialBuyerSchema.optional(),
  agent_details: z
    .object({
      network_profile: z.string().optional(),
      display_name: z.string().optional(),
    })
    .optional(),
});

export const updateCheckoutInputSchema = z.object({
  items: z.array(ticketLineItemSchema).min(1).optional(),
  buyer: partialBuyerSchema.optional(),
  fulfillment_option_id: z.string().optional(),
});

/** Card number or CVC typed into a field that must carry a token or PaymentMethod id. */
export function containsRawCardData(value: string): boolean {
  const compact = value.replace(/[\s-]/g, "");
  return /^\d{3,4}$/.test(compact) || /^\d{13,19}$/.test(compact);
}

export const paymentDataSchema = z
  .object({
    token: z.string().min(1),
    provider: z.literal("stripe"),
    handler_id: z.literal("card_tokenized"),
    billing_address: z
      .object({
        line1: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        postal_code: z.string().optional(),
        country: z.string().optional(),
      })
      .optional(),
    payment_method: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (containsRawCardData(data.token)) {
      ctx.addIssue({
        code: "custom",
        path: ["token"],
        message:
          "payment_data.token must be a Shared Payment Token (spt_…), not a card number or CVC",
      });
    }
    if (data.payment_method && containsRawCardData(data.payment_method)) {
      ctx.addIssue({
        code: "custom",
        path: ["payment_method"],
        message:
          "payment_data.payment_method must be a Stripe PaymentMethod id, not a card number or CVC",
      });
    }
  });

export const completeCheckoutInputSchema = z.object({
  payment_data: paymentDataSchema,
  buyer: partialBuyerSchema.optional(),
});
