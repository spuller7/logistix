import { LOGISTIX_VERSION } from "./version.js";
import { LogistixError, type LogistixErrorCode } from "./errors.js";
import type {
  CheckoutSession,
  CheckoutSessionWithOrder,
  CompleteCheckoutInput,
  CreateCheckoutInput,
  EventOffer,
  EventSearchQuery,
  LogistixClientOptions,
  SellerManifest,
  TicketTypeOffer,
  UpdateCheckoutInput,
} from "./types.js";

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export class LogistixClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly version: string;

  constructor(options: LogistixClientOptions) {
    if (!options.baseUrl) {
      throw new Error("LogistixClient requires baseUrl");
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.version = options.version ?? LOGISTIX_VERSION;
  }

  async getManifest(): Promise<SellerManifest> {
    return this.request<SellerManifest>("GET", "");
  }

  async searchEvents(query: EventSearchQuery = {}): Promise<EventOffer[]> {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.city) params.set("city", query.city);
    if (query.starts_after) params.set("starts_after", query.starts_after);
    if (query.starts_before) params.set("starts_before", query.starts_before);
    if (query.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    const body = await this.request<{ events: EventOffer[] }>("GET", qs ? `events?${qs}` : "events");
    return body.events;
  }

  async getEvent(eventId: string): Promise<EventOffer> {
    return this.request<EventOffer>("GET", `events/${encodeURIComponent(eventId)}`);
  }

  async listTicketTypes(eventId: string): Promise<TicketTypeOffer[]> {
    const body = await this.request<{ ticket_types: TicketTypeOffer[] }>(
      "GET",
      `events/${encodeURIComponent(eventId)}/ticket-types`
    );
    return body.ticket_types;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    return this.request<CheckoutSession>("POST", "checkout_sessions", input);
  }

  async getCheckout(checkoutId: string): Promise<CheckoutSession | CheckoutSessionWithOrder> {
    return this.request<CheckoutSession>(
      "GET",
      `checkout_sessions/${encodeURIComponent(checkoutId)}`
    );
  }

  async updateCheckout(checkoutId: string, input: UpdateCheckoutInput): Promise<CheckoutSession> {
    return this.request<CheckoutSession>(
      "POST",
      `checkout_sessions/${encodeURIComponent(checkoutId)}`,
      input
    );
  }

  async completeCheckout(
    checkoutId: string,
    input: CompleteCheckoutInput
  ): Promise<CheckoutSessionWithOrder> {
    return this.request<CheckoutSessionWithOrder>(
      "POST",
      `checkout_sessions/${encodeURIComponent(checkoutId)}/complete`,
      input
    );
  }

  async cancelCheckout(checkoutId: string): Promise<CheckoutSession> {
    return this.request<CheckoutSession>(
      "POST",
      `checkout_sessions/${encodeURIComponent(checkoutId)}/cancel`
    );
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Logistix-Version": this.version,
      "API-Version": this.version,
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await this.fetchImpl(joinUrl(this.baseUrl, path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: { code: "SELLER_ERROR", message: text } };
      }
    }

    if (!res.ok) {
      const err = parsed as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      } | null;
      throw new LogistixError(
        (err?.error?.code as LogistixErrorCode) || "SELLER_ERROR",
        err?.error?.message || `Logistix request failed (${res.status})`,
        res.status,
        err?.error?.details
      );
    }

    return parsed as T;
  }
}

export function createLogistixClient(options: LogistixClientOptions) {
  return new LogistixClient(options);
}
