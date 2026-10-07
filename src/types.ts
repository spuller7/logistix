/**
 * Linguistix seller protocol types. The wire protocol id is `logistix`.
 *
 * Agents discover a seller at `/.well-known/linguistix.json` and call the HTTP API.
 * Checkout follows Stripe Agentic Commerce: create → update → Shared Payment Token → complete.
 * Token issuance is a Stripe call made by the paying agent; this package confirms payment on the seller.
 */

export type MoneyCents = number;
export type IsoCurrency = string;
export type IsoDateTime = string;

export type CheckoutStatus =
  | "incomplete"
  | "ready_for_payment"
  | "processing"
  | "completed"
  | "canceled"
  | "requires_escalation";

export type FulfillmentType = "digital";

export type PaymentHandlerId = "card_tokenized";

export type TicketLineItem = {
  ticket_type_id: string;
  quantity: number;
  /** Optional promo unlocking a restricted ticket type. */
  promo_code?: string;
};

export type Buyer = {
  first_name?: string;
  last_name?: string;
  email: string;
  phone?: string;
};

export type TicketTypeOffer = {
  id: string;
  event_id: string;
  sku: string;
  name: string;
  description?: string | null;
  price_cents: MoneyCents;
  currency: IsoCurrency;
  quantity_available: number;
  requires_promo: boolean;
};

export type EventOffer = {
  id: string;
  seller_id: string;
  seller_name: string;
  title: string;
  description?: string | null;
  venue?: string | null;
  city?: string | null;
  address?: string | null;
  country: string;
  state?: string | null;
  postal_code?: string | null;
  starts_at: IsoDateTime;
  ends_at: IsoDateTime;
  timezone: string;
  currency: IsoCurrency;
  image_url?: string | null;
  url?: string | null;
  ticket_types?: TicketTypeOffer[];
};

export type EventSearchQuery = {
  q?: string;
  city?: string;
  starts_after?: IsoDateTime;
  starts_before?: IsoDateTime;
  limit?: number;
};

export type CheckoutLineItem = {
  id: string;
  ticket_type_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit_amount: MoneyCents;
  base_amount: MoneyCents;
  discount: MoneyCents;
  subtotal: MoneyCents;
  tax: MoneyCents;
  total: MoneyCents;
};

export type TotalLine = {
  type:
    | "items_base_amount"
    | "discount"
    | "subtotal"
    | "service_fee"
    | "fulfillment"
    | "tax"
    | "total";
  display_text: string;
  amount: MoneyCents;
};

export type DigitalFulfillmentOption = {
  type: FulfillmentType;
  id: string;
  title: string;
  subtitle: string;
  subtotal: MoneyCents;
  tax: MoneyCents;
  total: MoneyCents;
};

export type PaymentHandler = {
  id: PaymentHandlerId;
  name: "dev.acp.tokenized.card";
  version: "2026-01-22";
  requires_delegate_payment: true;
  psp: "stripe";
  config: {
    merchant_id?: string;
    network_profile?: string;
    accepted_brands: string[];
  };
};

export type CheckoutCapabilities = {
  payment: {
    handlers: PaymentHandler[];
  };
};

export type CheckoutSession = {
  id: string;
  event_id: string;
  currency: IsoCurrency;
  status: CheckoutStatus;
  buyer?: Buyer | null;
  line_items: CheckoutLineItem[];
  fulfillment_options: DigitalFulfillmentOption[];
  fulfillment_option_id: string;
  totals: TotalLine[];
  amount_total: MoneyCents;
  expires_at: IsoDateTime;
  capabilities: CheckoutCapabilities;
  messages?: { type: "info" | "error" | "warning"; text: string }[];
};

export type PaymentData = {
  /** Shared Payment Token id (`spt_…`) issued to the seller's Stripe profile. */
  token: string;
  provider: "stripe";
  handler_id: PaymentHandlerId;
  billing_address?: {
    line1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  /**
   * Dev/test fallback: a Stripe PaymentMethod id when SPT APIs are unavailable.
   * Live checkout sends an SPT in `token`.
   */
  payment_method?: string;
};

export type IssuedTicket = {
  id: string;
  ticket_type_id: string;
  ticket_type_name: string;
  unique_code?: string;
};

export type Order = {
  id: string;
  checkout_session_id: string;
  order_number: string;
  permalink_url: string;
  tickets?: IssuedTicket[];
};

export type CheckoutSessionWithOrder = CheckoutSession & {
  order: Order;
};

export type CreateCheckoutInput = {
  event_id: string;
  items: TicketLineItem[];
  buyer?: Partial<Buyer>;
  agent_details?: {
    network_profile?: string;
    display_name?: string;
  };
};

export type UpdateCheckoutInput = {
  items?: TicketLineItem[];
  buyer?: Partial<Buyer>;
  fulfillment_option_id?: string;
};

export type CompleteCheckoutInput = {
  payment_data: PaymentData;
  buyer?: Partial<Buyer>;
};

export type SellerManifest = {
  protocol: "logistix";
  /** Product name. Sellers should set this to Linguistix. */
  product?: "Linguistix";
  version: string;
  acp_version: string;
  seller: {
    id: string;
    name: string;
    stripe_network_profile?: string;
    stripe_account?: string;
  };
  capabilities: {
    search: boolean;
    ticket_types: boolean;
    checkout: boolean;
    agentic_payment: boolean;
    fulfillment: FulfillmentType[];
  };
  /**
   * Paths relative to the API mount (`events`, `checkout_sessions`).
   * The absolute mount URL lives in the discovery document, not here.
   */
  endpoints: {
    events: string;
    checkout_sessions: string;
  };
  payment: CheckoutCapabilities["payment"];
};
