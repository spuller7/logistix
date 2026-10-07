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

export const searchEventsToolSchema = z.object({
  query: z.string().describe("Artist, team, event name, or venue"),
  city: z.string().optional().describe("City or region filter"),
  starts_after: z.string().optional().describe("ISO 8601 lower bound for event start"),
  starts_before: z.string().optional().describe("ISO 8601 upper bound for event start"),
});

export const getEventToolSchema = z.object({
  event_id: z.string().describe("Logistix event id from search"),
});

export const listTicketTypesToolSchema = z.object({
  event_id: z.string().describe("Logistix event id"),
});

export const createCheckoutToolSchema = z.object({
  event_id: z.string(),
  items: z.array(ticketLineItemSchema).min(1),
  buyer_email: z.string().email().optional(),
  buyer_name: z.string().optional(),
  buyer_phone: z.string().optional(),
});

export const updateCheckoutToolSchema = z.object({
  checkout_id: z.string(),
  items: z.array(ticketLineItemSchema).min(1).optional(),
  buyer_email: z.string().email().optional(),
  buyer_name: z.string().optional(),
  buyer_phone: z.string().optional(),
});

export const getCheckoutToolSchema = z.object({
  checkout_id: z.string(),
});

export const completePurchaseToolSchema = z.object({
  checkout_id: z.string(),
  buyer_email: z.string().email().describe("Purchaser email for ticket delivery"),
  buyer_name: z.string().optional(),
  payment_method_id: z
    .string()
    .optional()
    .describe("Stripe PaymentMethod id collected in the agent UI. Omit to receive a hosted payment URL."),
});

export const cancelCheckoutToolSchema = z.object({
  checkout_id: z.string(),
});
