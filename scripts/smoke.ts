/**
 * Exercises discovery parsing and the seller HTTP handler.
 * Run with `npm run smoke` (emits to dist/, which is gitignored).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  STRIPE_AGENTIC_API_VERSION,
  UNEXPECTED_SELLER_ERROR_MESSAGE,
  buildLinguistixDiscoveryDocument,
  confirmPaymentIntentWithSharedToken,
  createLogistixHandler,
  linguistixDiscoveryDocumentSchema,
} from "../src/index.js";
import { EXAMPLE_AGENT_TOKEN, createSampleSeller, handler } from "../examples/seller-stub/stub.js";

const root = process.cwd();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const discoveryExample = JSON.parse(
  readFileSync(resolve(root, "examples/well-known/linguistix.json"), "utf8")
);
const parsedDiscovery = linguistixDiscoveryDocumentSchema.safeParse(discoveryExample);
if (!parsedDiscovery.success) {
  throw new Error(`well-known example failed schema: ${parsedDiscovery.error.message}`);
}
assert(parsedDiscovery.data.product === "Linguistix", "product name");
assert(parsedDiscovery.data.protocol === "logistix", "protocol id");
assert(parsedDiscovery.data.payment.collection.cardholder_data_in_chat === "forbidden", "no card data in chat");
assert(parsedDiscovery.data.payment.collection.primary_ui === "embedded_third_party", "embedded widget");
assert(parsedDiscovery.data.payment.collection.requires_action === "same_embedded_widget", "3ds in widget");
assert(parsedDiscovery.data.payment.collection.hosted_payment_url === "last_resort", "hosted url last resort");
assert(parsedDiscovery.data.payment.collection.seller_receives === "shared_payment_token", "spt only");

JSON.parse(readFileSync(resolve(root, "discovery/linguistix.discovery.schema.json"), "utf8"));

const openapi = readFileSync(resolve(root, "openapi/linguistix.openapi.yaml"), "utf8");
for (const route of [
  "operationId: getManifest",
  "operationId: searchEvents",
  "operationId: getEvent",
  "operationId: listTicketTypes",
  "operationId: createCheckout",
  "operationId: getCheckout",
  "operationId: updateCheckout",
  "operationId: completeCheckout",
  "operationId: cancelCheckout",
]) {
  assert(openapi.includes(route), `openapi missing ${route}`);
}

const auth = { authorization: `Bearer ${EXAMPLE_AGENT_TOKEN}` };

const missing = await handler({ method: "GET", path: "/", headers: {} });
assert(missing.status === 401, `expected 401 without a token, got ${missing.status}`);

const manifest = await handler({ method: "GET", path: "/", headers: auth });
assert(manifest.status === 200, "manifest");
const manifestBody = manifest.body as {
  product?: string;
  protocol?: string;
  seller: { id: string; stripe_network_profile?: string };
};
assert(manifestBody.product === "Linguistix", "manifest product");
assert(manifestBody.protocol === "logistix", "manifest protocol");
assert(manifestBody.seller.id === "example-seller", "manifest seller");
assert(manifestBody.seller.stripe_network_profile === "profile_example_seller", "platform profile");

const badLimit = await handler({
  method: "GET",
  path: "events",
  query: { limit: "0" },
  headers: auth,
});
assert(badLimit.status === 400, `expected 400 for limit=0, got ${badLimit.status}`);

const search = await handler({
  method: "GET",
  path: "/events",
  query: new URLSearchParams({ q: "harbor", city: "Seattle" }),
  headers: auth,
});
assert(search.status === 200, "search");
const events = (search.body as { events: { id: string }[] }).events;
assert(events.length === 1 && events[0]!.id === "evt_harbor_lights", "search hit");

const types = await handler({
  method: "GET",
  path: "events/evt_harbor_lights/ticket-types",
  headers: auth,
});
assert(types.status === 200, "ticket types");
assert((types.body as { ticket_types: unknown[] }).ticket_types.length === 2, "two types");

const created = await handler({
  method: "POST",
  path: "checkout_sessions",
  headers: auth,
  body: {
    event_id: "evt_harbor_lights",
    items: [{ ticket_type_id: "tt_ga", quantity: 2 }],
  },
});
assert(created.status === 201, `create ${created.status}`);
const createdBody = created.body as {
  id: string;
  status: string;
  amount_total: number;
  stripe_network_profile?: string;
  stripe_account?: string;
  capabilities: { payment: { handlers: { config: { network_profile?: string; merchant_id?: string } }[] } };
};
assert(createdBody.status === "incomplete", "incomplete without email");
assert(createdBody.amount_total === 9000, "2 x 4500");
assert(
  createdBody.stripe_network_profile !== manifestBody.seller.stripe_network_profile,
  "session profile differs from the seller manifest"
);
assert(createdBody.stripe_network_profile === "profile_example_harbor", "harbor organizer profile");
assert(createdBody.stripe_account === "acct_example_harbor", "harbor connected account");
assert(
  createdBody.capabilities.payment.handlers[0]?.config.network_profile === createdBody.stripe_network_profile,
  "handler network_profile echoes the session profile"
);

const updated = await handler({
  method: "POST",
  path: `checkout_sessions/${createdBody.id}`,
  headers: auth,
  body: { buyer: { email: "buyer@example.com", first_name: "Ada" } },
});
assert(updated.status === 200, "update");
const updatedBody = updated.body as { status: string; stripe_network_profile?: string };
assert(updatedBody.status === "ready_for_payment", "ready");
assert(updatedBody.stripe_network_profile === "profile_example_harbor", "profile survives update");

const completed = await handler({
  method: "POST",
  path: `checkout_sessions/${createdBody.id}/complete`,
  headers: auth,
  body: {
    payment_data: { token: "spt_example", provider: "stripe", handler_id: "card_tokenized" },
  },
});
assert(completed.status === 200, `complete ${completed.status} ${JSON.stringify(completed.body)}`);
const order = (completed.body as { status: string; order: { permalink_url: string; tickets: unknown[] } }).order;
assert((completed.body as { status: string }).status === "completed", "completed");
assert(order.tickets.length === 2, "two tickets");
assert(order.permalink_url.startsWith("https://"), "permalink");

const again = await handler({
  method: "GET",
  path: `checkout_sessions/${createdBody.id}`,
  headers: auth,
});
assert(again.status === 200, "get completed");
assert((again.body as { order?: { order_number: string } }).order?.order_number, "order number");

const soldOut = await handler({
  method: "POST",
  path: "checkout_sessions",
  headers: auth,
  body: {
    event_id: "evt_harbor_lights",
    items: [{ ticket_type_id: "tt_vip", quantity: 21 }],
    buyer: { email: "buyer@example.com" },
  },
});
assert(soldOut.status === 409, `sold out ${soldOut.status}`);

const second = await handler({
  method: "POST",
  path: "checkout_sessions",
  headers: auth,
  body: {
    event_id: "evt_mile_high_jazz",
    items: [{ ticket_type_id: "tt_jazz_ga", quantity: 1 }],
    buyer: { email: "buyer@example.com" },
  },
});
assert(second.status === 201, "second create");
const secondBody = second.body as { id: string; stripe_network_profile?: string };
assert(secondBody.stripe_network_profile === "profile_example_jazz", "jazz organizer profile");
const secondId = secondBody.id;
const canceled = await handler({
  method: "POST",
  path: `checkout_sessions/${secondId}/cancel`,
  headers: auth,
});
assert(canceled.status === 200, "cancel");
assert((canceled.body as { status: string }).status === "canceled", "canceled status");

const missingRoute = await handler({ method: "GET", path: "nope", headers: auth });
assert(missingRoute.status === 404, "unknown route");

const mounted = buildLinguistixDiscoveryDocument({
  seller: { id: "s", name: "S", stripeNetworkProfile: "profile_s" },
  apiMount: "https://tickets.example.com/api/logistix/",
  openapiUrl: "https://tickets.example.com/.well-known/linguistix-openapi.yaml",
  auth: { mode: "published", token: "public-agent-token" },
});
assert(mounted.api.mount === "https://tickets.example.com/api/logistix", "mount slash stripped");
assert(mounted.product === "Linguistix" && mounted.protocol === "logistix", "names");

let rejectedEmptyToken = false;
try {
  buildLinguistixDiscoveryDocument({
    seller: { id: "s", name: "S", stripeNetworkProfile: "profile_s" },
    apiMount: "https://tickets.example.com/api/logistix",
    openapiUrl: "https://tickets.example.com/openapi.yaml",
    auth: { mode: "published", token: "" },
  });
} catch {
  rejectedEmptyToken = true;
}
assert(rejectedEmptyToken, "empty published token rejected");

const acting = createSampleSeller({
  capturePayment: async () => ({ id: "pi_test", status: "requires_action" }),
});
const held = await acting.handler({
  method: "POST",
  path: "checkout_sessions",
  headers: auth,
  body: {
    event_id: "evt_harbor_lights",
    items: [{ ticket_type_id: "tt_ga", quantity: 1 }],
    buyer: { email: "buyer@example.com" },
  },
});
assert(held.status === 201, "capture seller create");
const heldId = (held.body as { id: string; status: string }).id;
assert((held.body as { status: string }).status === "ready_for_payment", "capture seller ready");
const needsAction = await acting.handler({
  method: "POST",
  path: `checkout_sessions/${heldId}/complete`,
  headers: auth,
  body: {
    payment_data: { token: "spt_example", provider: "stripe", handler_id: "card_tokenized" },
  },
});
assert(needsAction.status === 402, `expected 402 requires_action, got ${needsAction.status}`);
const pan = await acting.handler({
  method: "POST",
  path: `checkout_sessions/${heldId}/complete`,
  headers: auth,
  body: {
    payment_data: {
      token: "4242 4242 4242 4242",
      provider: "stripe",
      handler_id: "card_tokenized",
    },
  },
});
assert(pan.status === 400, `expected 400 for a PAN, got ${pan.status}`);
const stillOpen = await acting.handler({
  method: "GET",
  path: `checkout_sessions/${heldId}`,
  headers: auth,
});
assert((stillOpen.body as { status: string }).status === "ready_for_payment", "checkout stays open");

const idempotentSeller = createSampleSeller();
const idemHeaders = { ...auth, "idempotency-key": "  checkout-harbor-ada-1  " };
const idemCreate = await idempotentSeller.handler({
  method: "POST",
  path: "checkout_sessions",
  headers: idemHeaders,
  body: {
    event_id: "evt_harbor_lights",
    items: [{ ticket_type_id: "tt_ga", quantity: 1 }],
  },
});
assert(idemCreate.status === 201, "idempotent create");
const idemId = (idemCreate.body as { id: string }).id;
const idemUpdate = await idempotentSeller.handler({
  method: "POST",
  path: `checkout_sessions/${idemId}`,
  headers: { ...auth, "Idempotency-Key": "update-harbor-1" },
  body: { buyer: { email: "buyer@example.com" } },
});
assert(idemUpdate.status === 200, "idempotent update");
const captured: {
  idempotencyKey?: string;
  stripeNetworkProfile?: string;
  stripeAccount?: string;
} = {};
const paying = createSampleSeller({
  capturePayment: async (input) => {
    captured.idempotencyKey = input.idempotencyKey;
    captured.stripeNetworkProfile = input.stripeNetworkProfile;
    captured.stripeAccount = input.stripeAccount;
    return { id: "pi_test", status: "succeeded" };
  },
});
const payCreate = await paying.handler({
  method: "POST",
  path: "checkout_sessions",
  headers: { ...auth, "Idempotency-Key": "create-before-pay" },
  body: {
    event_id: "evt_mile_high_jazz",
    items: [{ ticket_type_id: "tt_jazz_ga", quantity: 1 }],
    buyer: { email: "buyer@example.com" },
  },
});
assert(payCreate.status === 201, "pay create");
const payId = (payCreate.body as { id: string; stripe_network_profile?: string }).id;
assert(
  (payCreate.body as { stripe_network_profile?: string }).stripe_network_profile === "profile_example_jazz",
  "pay session profile"
);
const payComplete = await paying.handler({
  method: "POST",
  path: `checkout_sessions/${payId}/complete`,
  headers: { ...auth, "Idempotency-Key": "complete-jazz-1" },
  body: {
    payment_data: { token: "spt_example", provider: "stripe", handler_id: "card_tokenized" },
  },
});
assert(payComplete.status === 200, "pay complete");
assert(captured.idempotencyKey === "complete-jazz-1", "complete key reached capture");
assert(captured.stripeNetworkProfile === "profile_example_jazz", "capture saw organizer profile");
assert(captured.stripeAccount === "acct_example_jazz", "capture saw connected account");
const payCancelTarget = await paying.handler({
  method: "POST",
  path: "checkout_sessions",
  headers: auth,
  body: {
    event_id: "evt_harbor_lights",
    items: [{ ticket_type_id: "tt_ga", quantity: 1 }],
  },
});
const cancelId = (payCancelTarget.body as { id: string }).id;
const payCancel = await paying.handler({
  method: "POST",
  path: `checkout_sessions/${cancelId}/cancel`,
  headers: { ...auth, "Idempotency-Key": "cancel-harbor-1" },
});
assert(payCancel.status === 200, "idempotent cancel");
const recorded = paying.mutations.map((entry) => `${entry.operation}:${entry.idempotencyKey ?? ""}`);
assert(recorded.includes("create:create-before-pay"), "create key recorded");
assert(recorded.includes("complete:complete-jazz-1"), "complete key recorded");
assert(recorded.includes("cancel:cancel-harbor-1"), "cancel key recorded");
assert(
  idempotentSeller.mutations.some((entry) => entry.operation === "create" && entry.idempotencyKey === "checkout-harbor-ada-1"),
  "create key trimmed"
);
assert(
  idempotentSeller.mutations.some((entry) => entry.operation === "update" && entry.idempotencyKey === "update-harbor-1"),
  "update key recorded"
);

const tooLong = await handler({
  method: "POST",
  path: "checkout_sessions",
  headers: { ...auth, "Idempotency-Key": "k".repeat(256) },
  body: {
    event_id: "evt_harbor_lights",
    items: [{ ticket_type_id: "tt_ga", quantity: 1 }],
  },
});
assert(tooLong.status === 400, `overlong idempotency key ${tooLong.status}`);

const logged: { message?: string; path?: string } = {};
const leak = "stripe account acct_secret_should_not_leak";
const unsafe = createLogistixHandler({
  adapter: {
    ...createSampleSeller().adapter,
    async createCheckout() {
      throw new Error(leak);
    },
  },
  apiKey: EXAMPLE_AGENT_TOKEN,
  onError(error, context) {
    logged.message = error instanceof Error ? error.message : String(error);
    logged.path = context.path;
  },
});
const crashed = await unsafe({
  method: "POST",
  path: "checkout_sessions",
  headers: auth,
  body: {
    event_id: "evt_harbor_lights",
    items: [{ ticket_type_id: "tt_ga", quantity: 1 }],
  },
});
assert(crashed.status === 500, `sanitized status ${crashed.status}`);
const crashedBody = crashed.body as { error: { code: string; message: string } };
assert(crashedBody.error.code === "SELLER_ERROR", "sanitized code");
assert(crashedBody.error.message === UNEXPECTED_SELLER_ERROR_MESSAGE, "generic 500 message");
assert(!JSON.stringify(crashed.body).includes("acct_secret"), "client body hides the exception");
assert(logged.message === leak, "onError kept the server-side message");
assert(logged.path === "checkout_sessions", "onError saw the path");

const loudLogger = createLogistixHandler({
  adapter: {
    ...createSampleSeller().adapter,
    async getManifest() {
      throw new Error("logger blew up");
    },
  },
  apiKey: EXAMPLE_AGENT_TOKEN,
  onError() {
    throw new Error("log sink down");
  },
});
const stillGeneric = await loudLogger({ method: "GET", path: "/", headers: auth });
assert(stillGeneric.status === 500, "onError throw still 500");
assert(
  (stillGeneric.body as { error: { message: string } }).error.message === UNEXPECTED_SELLER_ERROR_MESSAGE,
  "onError throw stays generic"
);
assert(!JSON.stringify(stillGeneric.body).includes("log sink"), "logger failure stays off the wire");

const calls: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
const payment = await confirmPaymentIntentWithSharedToken(
  {
    async rawRequest(_method, _path, params, options) {
      calls.push({
        params: (params ?? {}) as Record<string, unknown>,
        options: (options ?? {}) as Record<string, unknown>,
      });
      return { id: "pi_test", status: "succeeded" };
    },
  },
  {
    amountCents: 9000,
    currency: "usd",
    sharedPaymentToken: "spt_example",
    connectAccountId: "acct_example_harbor",
    idempotencyKey: "complete-jazz-1",
    hooks: {
      inputs: { tax: { calculation: "taxcalc_harbor" } },
      extra: { note: "keep" },
    },
  }
);
assert(payment.id === "pi_test", "confirm id");
assert(calls.length === 1, "one stripe call");
assert(calls[0]!.options.apiVersion === STRIPE_AGENTIC_API_VERSION, "stripe api version");
assert(STRIPE_AGENTIC_API_VERSION === "2026-09-30.preview", "preview version bumped");
assert(calls[0]!.options.idempotencyKey === "complete-jazz-1", "stripe idempotency key");
assert(
  (calls[0]!.options.headers as Record<string, string>)["Stripe-Account"] === "acct_example_harbor",
  "stripe account header"
);
assert(
  calls[0]!.params["hooks[inputs][tax][calculation]"] === "taxcalc_harbor",
  "tax calculation hook"
);
assert(calls[0]!.params["hooks[extra][note]"] === "keep", "hooks passthrough");
assert(
  calls[0]!.params["payment_method_data[shared_payment_granted_token]"] === "spt_example",
  "spt param"
);

const builtUrl = pathToFileURL(resolve(root, "dist/index.js")).href;
const built = (await import(builtUrl)) as {
  STRIPE_AGENTIC_API_VERSION: string;
  confirmPaymentIntentWithSharedToken: unknown;
  createLogistixHandler: unknown;
};
assert(built.STRIPE_AGENTIC_API_VERSION === "2026-09-30.preview", "dist preview version");
assert(typeof built.confirmPaymentIntentWithSharedToken === "function", "dist confirm export");
assert(typeof built.createLogistixHandler === "function", "dist handler export");
const indexDeclarations = readFileSync(resolve(root, "dist/index.d.ts"), "utf8");
const sessionDeclarations = readFileSync(resolve(root, "dist/types.d.ts"), "utf8");
assert(sessionDeclarations.includes("stripe_network_profile?: string"), "dist types include session profile");
assert(indexDeclarations.includes("idempotencyKeySchema"), "dist exports idempotency schema");
assert(indexDeclarations.includes("PaymentIntentHooks"), "dist exports hooks type");

console.log("smoke ok");
