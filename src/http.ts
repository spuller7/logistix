/**
 * Seller HTTP API mounted under the path advertised in `/.well-known/linguistix.json`.
 * The well-known discovery document is served at the site root, outside this handler.
 */
import { LOGISTIX_VERSION } from "./version.js";
import { LogistixError, isLogistixError } from "./errors.js";
import {
  completeCheckoutInputSchema,
  createCheckoutInputSchema,
  eventSearchQuerySchema,
  updateCheckoutInputSchema,
} from "./schemas.js";
import type {
  LogistixHandlerOptions,
  LogistixHttpRequest,
  LogistixHttpResponse,
} from "./seller.js";

function header(req: LogistixHttpRequest, name: string): string | undefined {
  const h = req.headers;
  if (!h) return undefined;
  if (h instanceof Headers) return h.get(name) ?? undefined;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (h[key] ?? undefined) : undefined;
}

function queryValue(
  query: LogistixHttpRequest["query"],
  key: string
): string | undefined {
  if (!query) return undefined;
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined;
  const v = query[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

function parsePath(path: string): string[] {
  return path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
}

function jsonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Logistix-Version": LOGISTIX_VERSION,
    "Cache-Control": "no-store",
  };
}

function authorize(req: LogistixHttpRequest, options: LogistixHandlerOptions) {
  const expected = options.apiKey?.trim();
  if (!expected) {
    if (options.allowUnauthenticatedDev) return;
    throw new LogistixError("UNAUTHORIZED", "Logistix API key is not configured", 401);
  }
  const raw = header(req, "authorization") ?? "";
  const token = raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : raw.trim();
  if (token !== expected) {
    throw new LogistixError("UNAUTHORIZED", "Invalid Logistix API key", 401);
  }
}

export async function handleLogistixRequest(
  req: LogistixHttpRequest,
  options: LogistixHandlerOptions
): Promise<LogistixHttpResponse> {
  try {
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") {
      return {
        status: 204,
        body: null,
        headers: {
          ...jsonHeaders(),
          Allow: "GET, POST, OPTIONS",
        },
      };
    }

    const parts = parsePath(req.path);
    const { adapter } = options;

    if (parts.length === 0 && method === "GET") {
      authorize(req, options);
      return { status: 200, body: await adapter.getManifest(), headers: jsonHeaders() };
    }

    authorize(req, options);

    if (parts[0] === "events" && parts.length === 1 && method === "GET") {
      const limitRaw = queryValue(req.query, "limit");
      const parsedQuery = eventSearchQuerySchema.safeParse({
        q: queryValue(req.query, "q"),
        city: queryValue(req.query, "city"),
        starts_after: queryValue(req.query, "starts_after"),
        starts_before: queryValue(req.query, "starts_before"),
        limit: limitRaw ? Number(limitRaw) : undefined,
      });
      if (!parsedQuery.success) {
        throw new LogistixError("VALIDATION_ERROR", parsedQuery.error.message, 400);
      }
      const events = await adapter.searchEvents(parsedQuery.data);
      return { status: 200, body: { events }, headers: jsonHeaders() };
    }

    if (parts[0] === "events" && parts.length === 2 && method === "GET") {
      const event = await adapter.getEvent(parts[1]!);
      if (!event) throw new LogistixError("NOT_FOUND", "Event not found", 404);
      return { status: 200, body: event, headers: jsonHeaders() };
    }

    if (
      parts[0] === "events" &&
      parts.length === 3 &&
      parts[2] === "ticket-types" &&
      method === "GET"
    ) {
      const event = await adapter.getEvent(parts[1]!);
      if (!event) throw new LogistixError("NOT_FOUND", "Event not found", 404);
      const ticket_types = await adapter.listTicketTypes(parts[1]!);
      return { status: 200, body: { ticket_types }, headers: jsonHeaders() };
    }

    if (parts[0] === "checkout_sessions" && parts.length === 1 && method === "POST") {
      const parsed = createCheckoutInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new LogistixError("VALIDATION_ERROR", parsed.error.message, 400);
      }
      const session = await adapter.createCheckout(parsed.data);
      return { status: 201, body: session, headers: jsonHeaders() };
    }

    if (parts[0] === "checkout_sessions" && parts.length === 2 && method === "GET") {
      const session = await adapter.getCheckout(parts[1]!);
      if (!session) throw new LogistixError("NOT_FOUND", "Checkout session not found", 404);
      return { status: 200, body: session, headers: jsonHeaders() };
    }

    if (parts[0] === "checkout_sessions" && parts.length === 2 && method === "POST") {
      const parsed = updateCheckoutInputSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new LogistixError("VALIDATION_ERROR", parsed.error.message, 400);
      }
      const session = await adapter.updateCheckout(parts[1]!, parsed.data);
      return { status: 200, body: session, headers: jsonHeaders() };
    }

    if (
      parts[0] === "checkout_sessions" &&
      parts.length === 3 &&
      parts[2] === "complete" &&
      method === "POST"
    ) {
      const parsed = completeCheckoutInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new LogistixError("VALIDATION_ERROR", parsed.error.message, 400);
      }
      const session = await adapter.completeCheckout(parts[1]!, parsed.data);
      return { status: 200, body: session, headers: jsonHeaders() };
    }

    if (
      parts[0] === "checkout_sessions" &&
      parts.length === 3 &&
      parts[2] === "cancel" &&
      method === "POST"
    ) {
      const session = await adapter.cancelCheckout(parts[1]!);
      return { status: 200, body: session, headers: jsonHeaders() };
    }

    throw new LogistixError("NOT_FOUND", `No Logistix route for ${method} /${parts.join("/")}`, 404);
  } catch (err) {
    if (isLogistixError(err)) {
      return { status: err.status, body: err.toJSON(), headers: jsonHeaders() };
    }
    const message = err instanceof Error ? err.message : "Unexpected seller error";
    return {
      status: 500,
      body: { error: { code: "SELLER_ERROR", message } },
      headers: jsonHeaders(),
    };
  }
}

export function createLogistixHandler(options: LogistixHandlerOptions) {
  return (req: LogistixHttpRequest) => handleLogistixRequest(req, options);
}
