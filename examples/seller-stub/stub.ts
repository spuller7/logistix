/**
 * Generic in-memory seller. This is not the Open Gate application.
 * It shows the adapter, the HTTP handler, and a discovery document that point at the same seller.
 */
import {
  DIGITAL_FULFILLMENT_ID,
  LogistixError,
  amountTotalFromTotals,
  buildLinguistixDiscoveryDocument,
  buildSellerManifest,
  buildTotals,
  createLogistixHandler,
  defaultCapabilities,
  deriveCheckoutStatus,
  digitalFulfillmentOption,
  stripeCardHandler,
  type CheckoutSession,
  type CheckoutSessionWithOrder,
  type CompleteCheckoutInput,
  type CreateCheckoutInput,
  type EventOffer,
  type EventSearchQuery,
  type LogistixSellerAdapter,
  type TicketTypeOffer,
  type UpdateCheckoutInput,
} from "../../src/index.js";

export const EXAMPLE_AGENT_TOKEN = "example-agent-token";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SELLER = {
  id: "example-seller",
  name: "Example Seller",
  stripeNetworkProfile: "bp_example_seller",
  stripeAccount: "acct_example_seller",
};

type CapturePayment = (input: {
  amountCents: number;
  currency: string;
  sharedPaymentToken: string;
  receiptEmail?: string;
}) => Promise<{ id: string; status: string }>;

type StoredTicketType = TicketTypeOffer & { stock: number };

const EVENTS: EventOffer[] = [
  {
    id: "evt_harbor_lights",
    seller_id: SELLER.id,
    seller_name: SELLER.name,
    title: "Harbor Lights",
    description: "An evening at the pier.",
    venue: "Pier Hall",
    city: "Seattle",
    address: "1 Alaskan Way",
    country: "US",
    state: "WA",
    postal_code: "98101",
    starts_at: "2026-11-14T03:00:00.000Z",
    ends_at: "2026-11-14T06:00:00.000Z",
    timezone: "America/Los_Angeles",
    currency: "usd",
    url: "https://tickets.example.com/events/harbor-lights",
  },
  {
    id: "evt_mile_high_jazz",
    seller_id: SELLER.id,
    seller_name: SELLER.name,
    title: "Mile High Jazz",
    venue: "Union Room",
    city: "Denver",
    country: "US",
    state: "CO",
    postal_code: "80202",
    starts_at: "2026-12-02T02:00:00.000Z",
    ends_at: "2026-12-02T05:00:00.000Z",
    timezone: "America/Denver",
    currency: "usd",
    url: "https://tickets.example.com/events/mile-high-jazz",
  },
];

const TICKET_TYPES: StoredTicketType[] = [
  {
    id: "tt_ga",
    event_id: "evt_harbor_lights",
    sku: "HARBOR-GA",
    name: "General admission",
    price_cents: 4500,
    currency: "usd",
    quantity_available: 0,
    requires_promo: false,
    stock: 100,
  },
  {
    id: "tt_vip",
    event_id: "evt_harbor_lights",
    sku: "HARBOR-VIP",
    name: "VIP",
    price_cents: 12000,
    currency: "usd",
    quantity_available: 0,
    requires_promo: false,
    stock: 20,
  },
  {
    id: "tt_jazz_ga",
    event_id: "evt_mile_high_jazz",
    sku: "JAZZ-GA",
    name: "General admission",
    price_cents: 3500,
    currency: "usd",
    quantity_available: 0,
    requires_promo: false,
    stock: 80,
  },
];

export function createSampleSeller(options?: {
  capturePayment?: CapturePayment;
  apiKey?: string;
  apiMount?: string;
  openapiUrl?: string;
}) {
  const sessions = new Map<string, CheckoutSession>();
  let seq = 0;
  const nextId = (prefix: string) => {
    seq += 1;
    return `${prefix}_${seq.toString(36)}`;
  };

  const paymentHandler = stripeCardHandler({
    merchantId: SELLER.stripeAccount,
    networkProfile: SELLER.stripeNetworkProfile,
  });
  const capabilities = defaultCapabilities(paymentHandler);

  function heldQuantity(ticketTypeId: string, exceptSessionId?: string) {
    let held = 0;
    for (const session of sessions.values()) {
      if (session.id === exceptSessionId || session.status === "canceled") continue;
      for (const line of session.line_items) {
        if (line.ticket_type_id === ticketTypeId) held += line.quantity;
      }
    }
    return held;
  }

  function toOffer(type: StoredTicketType, exceptSessionId?: string): TicketTypeOffer {
    const { stock, ...offer } = type;
    return {
      ...offer,
      quantity_available: Math.max(0, stock - heldQuantity(type.id, exceptSessionId)),
    };
  }

  function typesFor(eventId: string, exceptSessionId?: string) {
    return TICKET_TYPES.filter((type) => type.event_id === eventId).map((type) =>
      toOffer(type, exceptSessionId)
    );
  }

  function publicEvent(event: EventOffer, withTickets: boolean): EventOffer {
    if (!withTickets) return { ...event };
    return { ...event, ticket_types: typesFor(event.id) };
  }

  function lineItems(eventId: string, items: CreateCheckoutInput["items"], exceptSessionId?: string) {
    const seen = new Set<string>();
    return items.map((item) => {
      if (seen.has(item.ticket_type_id)) {
        throw new LogistixError("VALIDATION_ERROR", "Duplicate ticket_type_id in items", 400);
      }
      seen.add(item.ticket_type_id);
      const stored = TICKET_TYPES.find((type) => type.id === item.ticket_type_id && type.event_id === eventId);
      if (!stored) throw new LogistixError("NOT_FOUND", "Ticket type not found", 404);
      const available = toOffer(stored, exceptSessionId).quantity_available;
      if (item.quantity > available) {
        throw new LogistixError("SOLD_OUT", `${stored.name} does not have enough inventory`, 409);
      }
      const base = stored.price_cents * item.quantity;
      return {
        id: `li_${item.ticket_type_id}`,
        ticket_type_id: stored.id,
        sku: stored.sku,
        name: stored.name,
        quantity: item.quantity,
        unit_amount: stored.price_cents,
        base_amount: base,
        discount: 0,
        subtotal: base,
        tax: 0,
        total: base,
      };
    });
  }

  function sessionFrom(
    id: string,
    event: EventOffer,
    items: CreateCheckoutInput["items"],
    buyer: CreateCheckoutInput["buyer"],
    exceptSessionId?: string,
    expiresAt?: string
  ): CheckoutSession {
    const lines = lineItems(event.id, items, exceptSessionId);
    const totals = buildTotals({ itemsBase: lines.reduce((sum, line) => sum + line.base_amount, 0) });
    const email = buyer?.email;
    const status = deriveCheckoutStatus({
      itemsOk: lines.length > 0,
      inventoryOk: true,
      buyer: email ? { email } : undefined,
    });
    return {
      id,
      event_id: event.id,
      currency: event.currency,
      status,
      buyer: email ? { ...buyer, email } : null,
      line_items: lines,
      fulfillment_options: [digitalFulfillmentOption()],
      fulfillment_option_id: DIGITAL_FULFILLMENT_ID,
      totals,
      amount_total: amountTotalFromTotals(totals),
      expires_at: expiresAt ?? new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      capabilities,
      ...(status === "incomplete"
        ? { messages: [{ type: "info" as const, text: "Buyer email is required before payment." }] }
        : {}),
    };
  }

  const adapter: LogistixSellerAdapter = {
    async getManifest() {
      return buildSellerManifest({ seller: SELLER });
    },
    async searchEvents(query: EventSearchQuery) {
      const q = query.q?.toLowerCase();
      return EVENTS.filter((event) => {
        if (q) {
          const haystack = [event.title, event.venue, event.city, event.description]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        if (query.city && event.city?.toLowerCase() !== query.city.toLowerCase()) return false;
        if (query.starts_after && event.starts_at < query.starts_after) return false;
        if (query.starts_before && event.starts_at > query.starts_before) return false;
        return true;
      })
        .slice(0, query.limit ?? EVENTS.length)
        .map((event) => publicEvent(event, false));
    },
    async getEvent(eventId: string) {
      const event = EVENTS.find((candidate) => candidate.id === eventId);
      return event ? publicEvent(event, true) : null;
    },
    async listTicketTypes(eventId: string) {
      if (!EVENTS.some((event) => event.id === eventId)) {
        throw new LogistixError("NOT_FOUND", "Event not found", 404);
      }
      return typesFor(eventId);
    },
    async createCheckout(input: CreateCheckoutInput) {
      const event = EVENTS.find((candidate) => candidate.id === input.event_id);
      if (!event) throw new LogistixError("NOT_FOUND", "Event not found", 404);
      const session = sessionFrom(nextId("cs"), event, input.items, input.buyer);
      sessions.set(session.id, session);
      return clone(session);
    },
    async getCheckout(checkoutId: string) {
      const session = sessions.get(checkoutId);
      return session ? clone(session) : null;
    },
    async updateCheckout(checkoutId: string, input: UpdateCheckoutInput) {
      const current = sessions.get(checkoutId);
      if (!current) throw new LogistixError("NOT_FOUND", "Checkout session not found", 404);
      if (current.status === "completed") {
        throw new LogistixError("CHECKOUT_COMPLETED", "Checkout already completed", 409);
      }
      if (current.status === "canceled") {
        throw new LogistixError("CHECKOUT_CANCELED", "Checkout is canceled", 409);
      }
      if (
        input.fulfillment_option_id &&
        input.fulfillment_option_id !== DIGITAL_FULFILLMENT_ID
      ) {
        throw new LogistixError("VALIDATION_ERROR", "Only digital ticket fulfillment is offered", 400);
      }
      const event = EVENTS.find((candidate) => candidate.id === current.event_id);
      if (!event) throw new LogistixError("NOT_FOUND", "Event not found", 404);
      const items =
        input.items ??
        current.line_items.map((line) => ({
          ticket_type_id: line.ticket_type_id,
          quantity: line.quantity,
        }));
      const buyer = {
        ...(current.buyer ?? {}),
        ...(input.buyer ?? {}),
      };
      const session = sessionFrom(current.id, event, items, buyer, current.id, current.expires_at);
      sessions.set(session.id, session);
      return clone(session);
    },
    async completeCheckout(checkoutId: string, input: CompleteCheckoutInput) {
      const current = sessions.get(checkoutId);
      if (!current) throw new LogistixError("NOT_FOUND", "Checkout session not found", 404);
      if (current.status !== "ready_for_payment") {
        throw new LogistixError("CHECKOUT_NOT_READY", "Checkout is not ready for payment", 409);
      }
      const buyer = input.buyer?.email ? { ...current.buyer, ...input.buyer } : current.buyer;
      if (!buyer?.email) {
        throw new LogistixError("CHECKOUT_NOT_READY", "Buyer email is required", 409);
      }
      if (options?.capturePayment) {
        const payment = await options.capturePayment({
          amountCents: current.amount_total,
          currency: current.currency,
          sharedPaymentToken: input.payment_data.token,
          receiptEmail: buyer.email,
        });
        if (payment.status === "requires_action") {
          throw new LogistixError(
            "PAYMENT_ACTION_REQUIRED",
            "Buyer authentication is required before tickets can be issued",
            402
          );
        }
        if (payment.status !== "succeeded" && payment.status !== "requires_capture") {
          throw new LogistixError("PAYMENT_DECLINED", `Payment was not captured (${payment.status})`, 402);
        }
      }
      const orderNumber = nextId("ord");
      const completed: CheckoutSessionWithOrder = {
        ...current,
        status: "completed",
        buyer: { ...buyer, email: buyer.email },
        messages: undefined,
        order: {
          id: nextId("order"),
          checkout_session_id: current.id,
          order_number: orderNumber,
          permalink_url: `https://tickets.example.com/orders/${orderNumber}`,
          tickets: current.line_items.flatMap((line) =>
            Array.from({ length: line.quantity }, () => ({
              id: nextId("tkt"),
              ticket_type_id: line.ticket_type_id,
              ticket_type_name: line.name,
              unique_code: nextId("code"),
            }))
          ),
        },
      };
      sessions.set(completed.id, completed);
      return clone(completed);
    },
    async cancelCheckout(checkoutId: string) {
      const current = sessions.get(checkoutId);
      if (!current) throw new LogistixError("NOT_FOUND", "Checkout session not found", 404);
      if (current.status === "completed") {
        throw new LogistixError("CHECKOUT_COMPLETED", "Checkout already completed", 409);
      }
      const canceled: CheckoutSession = { ...current, status: "canceled" };
      sessions.set(canceled.id, canceled);
      return clone(canceled);
    },
  };

  const apiKey = options?.apiKey ?? EXAMPLE_AGENT_TOKEN;
  const discovery = buildLinguistixDiscoveryDocument({
    seller: SELLER,
    apiMount: options?.apiMount ?? "https://tickets.example.com/api/logistix",
    openapiUrl: options?.openapiUrl ?? "https://tickets.example.com/.well-known/linguistix-openapi.yaml",
    auth: {
      mode: "published",
      token: apiKey,
      instructions:
        "Send this bearer token on every request to api.mount. Replace it in production with the seller's published agent credential.",
    },
  });

  return {
    adapter,
    discovery,
    handler: createLogistixHandler({ adapter, apiKey }),
  };
}

const sample = createSampleSeller();

export const adapter = sample.adapter;
export const discovery = sample.discovery;
export const handler = sample.handler;
