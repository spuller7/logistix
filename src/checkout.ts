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
 * Canonical ticket purchase flow.
 * HTTP paths are relative to the seller mount from `/.well-known/linguistix.json`.
 * Shared Payment Token issuance is a Stripe API call made by the paying agent.
 */
export const TICKET_PURCHASE_FLOW = [
  {
    step: 1,
    name: "discover_seller",
    description:
      "Find the seller from llms.txt or the event page and read /.well-known/linguistix.json for the API mount, OpenAPI, auth, and Stripe seller profile.",
    http: "GET /.well-known/linguistix.json",
  },
  {
    step: 2,
    name: "discover_events",
    description: "Search published events and read one event.",
    http: "GET /events, GET /events/{id}",
  },
  {
    step: 3,
    name: "select",
    description: "List ticket types, prices in cents, and remaining inventory.",
    http: "GET /events/{id}/ticket-types",
  },
  {
    step: 4,
    name: "create_checkout",
    description: "Open a checkout session. The seller holds inventory and returns totals.",
    http: "POST /checkout_sessions",
  },
  {
    step: 5,
    name: "update_checkout",
    description: "Attach the buyer and adjust quantities until status is ready_for_payment.",
    http: "POST /checkout_sessions/{id}",
  },
  {
    step: 6,
    name: "issue_shared_payment_token",
    description:
      "The paying agent issues a Stripe Shared Payment Token scoped to payment.stripe_network_profile from the discovery document. Linguistix does not issue tokens.",
    http: "Stripe POST /v1/shared_payment/issued_tokens",
  },
  {
    step: 7,
    name: "complete",
    description: "Send the SPT. The seller confirms a PaymentIntent and issues digital tickets.",
    http: "POST /checkout_sessions/{id}/complete",
  },
  {
    step: 8,
    name: "confirm",
    description: "Read the completed session and give the buyer order.permalink_url.",
    http: "GET /checkout_sessions/{id}",
  },
] as const;
