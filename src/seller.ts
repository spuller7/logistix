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
 * Context the HTTP handler passes into mutating checkout adapter calls.
 * Comes from request headers, not the JSON body.
 */
export type CheckoutRequestContext = {
  /**
   * `Idempotency-Key` header after trimming, when the agent sent one.
   * Forward this to `confirmPaymentIntentWithSharedToken` on complete.
   */
  idempotencyKey?: string;
};

/**
 * What a ticketing platform implements to sell through Linguistix.
 * Mount with `createLogistixHandler` at the URL published in `/.well-known/linguistix.json`.
 *
 * Mutating checkout methods receive `CheckoutRequestContext` when the handler
 * calls them. Implementations may omit the argument.
 */
export interface LogistixSellerAdapter {
  getManifest(): Promise<SellerManifest>;
  searchEvents(query: EventSearchQuery): Promise<EventOffer[]>;
  getEvent(eventId: string): Promise<EventOffer | null>;
  listTicketTypes(eventId: string): Promise<TicketTypeOffer[]>;
  createCheckout(
    input: CreateCheckoutInput,
    context?: CheckoutRequestContext
  ): Promise<CheckoutSession>;
  getCheckout(checkoutId: string): Promise<CheckoutSession | CheckoutSessionWithOrder | null>;
  updateCheckout(
    checkoutId: string,
    input: UpdateCheckoutInput,
    context?: CheckoutRequestContext
  ): Promise<CheckoutSession>;
  completeCheckout(
    checkoutId: string,
    input: CompleteCheckoutInput,
    context?: CheckoutRequestContext
  ): Promise<CheckoutSessionWithOrder>;
  cancelCheckout(checkoutId: string, context?: CheckoutRequestContext): Promise<CheckoutSession>;
}

export type LogistixHandlerOptions = {
  adapter: LogistixSellerAdapter;
  apiKey?: string;
  /** When true and apiKey is unset, allow unauthenticated local development. */
  allowUnauthenticatedDev?: boolean;
  /**
   * Unexpected errors (anything that is not a `LogistixError`). The HTTP response
   * stays a generic 500. Use this to log the real error on the server.
   * `context` is the method and mount-relative path only, so a logger does not
   * have to touch the `Authorization` header.
   */
  onError?: (error: unknown, context: { method: string; path: string }) => void;
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
