import type { ChatCompletionTool } from "./openai-tool-types.js";
import { TICKET_PURCHASE_FLOW } from "./checkout.js";

const flowHint = TICKET_PURCHASE_FLOW.map((s) => `${s.step}. ${s.name}`).join(" → ");

/** OpenAI-compatible tool definitions any chat agent can register. */
export const logistixOpenAITools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "logistix_search_events",
      description:
        "Search a Logistix ticketing seller for published events. Use before selecting tickets. Purchase flow: " +
        flowHint,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Artist, team, event name, or venue" },
          city: { type: "string", description: "City or region filter" },
          starts_after: { type: "string", description: "ISO 8601 lower bound" },
          starts_before: { type: "string", description: "ISO 8601 upper bound" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "logistix_get_event",
      description: "Get one event from a Logistix seller, including ticket types when the seller includes them.",
      parameters: {
        type: "object",
        properties: { event_id: { type: "string" } },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "logistix_list_ticket_types",
      description:
        "List available ticket types (SKUs), prices in cents, and remaining inventory for an event. Required before creating a checkout.",
      parameters: {
        type: "object",
        properties: { event_id: { type: "string" } },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "logistix_create_checkout",
      description:
        "Start a ticket checkout session with selected ticket types and quantities. Returns totals, tax, and status. Session is ready_for_payment once a buyer email is present.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ticket_type_id: { type: "string" },
                quantity: { type: "integer", minimum: 1 },
                promo_code: { type: "string" },
              },
              required: ["ticket_type_id", "quantity"],
            },
          },
          buyer_email: { type: "string" },
          buyer_name: { type: "string" },
          buyer_phone: { type: "string" },
        },
        required: ["event_id", "items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "logistix_update_checkout",
      description: "Update ticket quantities or buyer details on an open checkout session.",
      parameters: {
        type: "object",
        properties: {
          checkout_id: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ticket_type_id: { type: "string" },
                quantity: { type: "integer", minimum: 1 },
                promo_code: { type: "string" },
              },
              required: ["ticket_type_id", "quantity"],
            },
          },
          buyer_email: { type: "string" },
          buyer_name: { type: "string" },
          buyer_phone: { type: "string" },
        },
        required: ["checkout_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "logistix_get_checkout",
      description: "Retrieve the authoritative checkout session (totals, status, order after completion).",
      parameters: {
        type: "object",
        properties: { checkout_id: { type: "string" } },
        required: ["checkout_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "logistix_complete_purchase",
      description:
        "Pay for a ready_for_payment checkout using Stripe Agentic Commerce. The agent issues a Shared Payment Token to the seller, then the seller captures payment and issues tickets. If payment_method_id is omitted, returns a hosted payment URL the buyer must open.",
      parameters: {
        type: "object",
        properties: {
          checkout_id: { type: "string" },
          buyer_email: { type: "string", description: "Required for ticket delivery" },
          buyer_name: { type: "string" },
          payment_method_id: {
            type: "string",
            description: "Stripe PaymentMethod id from the agent payment UI",
          },
        },
        required: ["checkout_id", "buyer_email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "logistix_cancel_checkout",
      description: "Cancel an open checkout and release held inventory.",
      parameters: {
        type: "object",
        properties: { checkout_id: { type: "string" } },
        required: ["checkout_id"],
      },
    },
  },
];

export const LOGISTIX_AGENT_SYSTEM_PROMPT = `You can buy primary-market tickets through Logistix, a standard tool for ticketing platforms.

Purchase flow (always in this order):
1. logistix_search_events — find the event
2. logistix_list_ticket_types — show types, prices, and remaining inventory
3. Confirm the buyer's ticket type + quantity (and promo code if requires_promo)
4. logistix_create_checkout — then logistix_update_checkout with buyer email if status is incomplete
5. logistix_complete_purchase — payment uses Stripe Shared Payment Tokens (agentic commerce). Never invent card numbers. If the tool returns payment_url, send the buyer there.
6. Relay order_number, permalink_url, and that tickets arrive by email.

Rules:
- Never complete payment without an explicit buyer confirmation of event, ticket type, quantity, and total.
- Prices and inventory come only from Logistix tools.
- Digital fulfillment: no shipping address is required.
- If a ticket type requires_promo, collect a promo code before checkout.`;
