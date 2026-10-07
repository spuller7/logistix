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

export const paymentDataSchema = z.object({
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
});

export const completeCheckoutInputSchema = z.object({
  payment_data: paymentDataSchema,
  buyer: partialBuyerSchema.optional(),
});
