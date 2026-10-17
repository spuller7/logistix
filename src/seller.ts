import type {
  CheckoutSession,
  CheckoutSessionWithOrder,
  CompleteCheckoutInput,
  CreateCheckoutInput,
  EventOffer,
  EventSearchQuery,
  SellerManifest,
  TicketTypeOffer,
  UpdateCheckoutInput,
} from "./types.js";

/**
 * What a ticketing platform implements to sell through Linguistix.
 * Mount with `createLogistixHandler` at the URL published in `/.well-known/linguistix.json`.
 */
export interface LogistixSellerAdapter {
  getManifest(): Promise<SellerManifest>;
  searchEvents(query: EventSearchQuery): Promise<EventOffer[]>;
  getEvent(eventId: string): Promise<EventOffer | null>;
  listTicketTypes(eventId: string): Promise<TicketTypeOffer[]>;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  getCheckout(checkoutId: string): Promise<CheckoutSession | CheckoutSessionWithOrder | null>;
  updateCheckout(checkoutId: string, input: UpdateCheckoutInput): Promise<CheckoutSession>;
  completeCheckout(
    checkoutId: string,
    input: CompleteCheckoutInput
  ): Promise<CheckoutSessionWithOrder>;
  cancelCheckout(checkoutId: string): Promise<CheckoutSession>;
}

export type LogistixHandlerOptions = {
  adapter: LogistixSellerAdapter;
  apiKey?: string;
  /** When true and apiKey is unset, allow unauthenticated local development. */
  allowUnauthenticatedDev?: boolean;
};

export type LogistixHttpRequest = {
  method: string;
  /** Path under the seller mount, e.g. `events` or `checkout_sessions/cs_1/complete`. */
  path: string;
  query?: URLSearchParams | Record<string, string | string[] | undefined>;
  headers?: Headers | Record<string, string | null | undefined>;
  body?: unknown;
};

export type LogistixHttpResponse = {
  status: number;
  body: unknown;
  headers: Record<string, string>;
};
