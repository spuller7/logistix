import type {
  Buyer,
  CheckoutCapabilities,
  CheckoutSession,
  CheckoutStatus,
  DigitalFulfillmentOption,
  PaymentHandler,
  TotalLine,
} from "./types.js";

export const DIGITAL_FULFILLMENT_ID = "fulfill_digital_tickets";

export function stripeCardHandler(opts?: {
  merchantId?: string;
  networkProfile?: string;
}): PaymentHandler {
  return {
    id: "card_tokenized",
    name: "dev.acp.tokenized.card",
    version: "2026-01-22",
    requires_delegate_payment: true,
    psp: "stripe",
    config: {
      merchant_id: opts?.merchantId,
      network_profile: opts?.networkProfile,
      accepted_brands: ["visa", "mastercard", "amex", "discover"],
    },
  };
}

export function defaultCapabilities(handler?: PaymentHandler): CheckoutCapabilities {
  return {
    payment: {
      handlers: [handler ?? stripeCardHandler()],
    },
  };
}

export function digitalFulfillmentOption(): DigitalFulfillmentOption {
  return {
    type: "digital",
    id: DIGITAL_FULFILLMENT_ID,
    title: "Digital tickets",
    subtitle: "Delivered by email and wallet pass after payment",
    subtotal: 0,
    tax: 0,
    total: 0,
  };
}

export function deriveCheckoutStatus(input: {
  itemsOk: boolean;
  buyer?: Partial<Buyer> | null;
  inventoryOk: boolean;
}): CheckoutStatus {
  if (!input.itemsOk || !input.inventoryOk) return "incomplete";
  if (!input.buyer?.email) return "incomplete";
  return "ready_for_payment";
}

export function buildTotals(parts: {
  itemsBase: number;
  discount?: number;
  serviceFee?: number;
  tax?: number;
}): TotalLine[] {
  const discount = parts.discount ?? 0;
  const serviceFee = parts.serviceFee ?? 0;
  const tax = parts.tax ?? 0;
  const subtotal = parts.itemsBase - discount;
  const total = subtotal + serviceFee + tax;
  return [
    { type: "items_base_amount", display_text: "Tickets", amount: parts.itemsBase },
    ...(discount ? [{ type: "discount" as const, display_text: "Discount", amount: -discount }] : []),
    { type: "subtotal", display_text: "Subtotal", amount: subtotal },
    { type: "fulfillment", display_text: "Delivery", amount: 0 },
    ...(serviceFee
      ? [{ type: "service_fee" as const, display_text: "Service fee", amount: serviceFee }]
      : []),
    { type: "tax", display_text: "Tax", amount: tax },
    { type: "total", display_text: "Total", amount: total },
  ];
}

export function amountTotalFromTotals(totals: TotalLine[]): number {
  return totals.find((t) => t.type === "total")?.amount ?? 0;
}

export function assertMutable(session: Pick<CheckoutSession, "status">) {
  if (session.status === "completed") {
    throw Object.assign(new Error("Checkout already completed"), { code: "CHECKOUT_COMPLETED" });
  }
  if (session.status === "canceled") {
    throw Object.assign(new Error("Checkout is canceled"), { code: "CHECKOUT_CANCELED" });
  }
}

/**
 * Canonical ticket purchase flow for agents and sellers.
 * Each step maps to a Logistix HTTP method and a Stripe ACS/ACP concept.
 */
export const TICKET_PURCHASE_FLOW = [
  {
    step: 1,
    name: "discover",
    description: "Search published events and inspect ticket types / inventory.",
    seller: "GET /events, GET /events/{id}, GET /events/{id}/ticket-types",
    agent_tools: ["logistix_search_events", "logistix_get_event", "logistix_list_ticket_types"],
  },
  {
    step: 2,
    name: "select",
    description: "Buyer chooses ticket type SKUs and quantities (and promo codes if required).",
    seller: "Agent holds selection locally until checkout create",
    agent_tools: ["logistix_list_ticket_types"],
  },
  {
    step: 3,
    name: "create_checkout",
    description: "Open a stateful checkout session. Seller holds inventory and returns totals.",
    seller: "POST /checkout_sessions (ACP create)",
    agent_tools: ["logistix_create_checkout"],
  },
  {
    step: 4,
    name: "update_checkout",
    description: "Attach buyer identity; adjust quantities. Session becomes ready_for_payment.",
    seller: "POST /checkout_sessions/{id} (ACP update)",
    agent_tools: ["logistix_update_checkout"],
  },
  {
    step: 5,
    name: "collect_payment",
    description:
      "Agent collects a PaymentMethod with Stripe Elements, then issues a Shared Payment Token scoped to the seller Stripe profile (amount, currency, expiry).",
    seller: "Seller Stripe profile advertised on the manifest",
    agent_tools: ["logistix_complete_purchase"],
    stripe: "POST /v1/shared_payment/issued_tokens",
  },
  {
    step: 6,
    name: "complete",
    description:
      "Agent sends the SPT. Seller confirms a PaymentIntent with the granted token, creates the order, and issues tickets.",
    seller: "POST /checkout_sessions/{id}/complete (ACP complete)",
    agent_tools: ["logistix_complete_purchase"],
    stripe: "PaymentIntent with payment_method_data.shared_payment_granted_token",
  },
  {
    step: 7,
    name: "confirm",
    description: "Return order permalink and ticket confirmation for the chat to relay to the buyer.",
    seller: "GET /checkout_sessions/{id}",
    agent_tools: ["logistix_get_checkout"],
  },
] as const;
