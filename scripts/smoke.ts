/**
 * Exercises discovery parsing and the seller HTTP handler.
 * Run with `npm run smoke` (emits to dist/, which is gitignored).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildLinguistixDiscoveryDocument, linguistixDiscoveryDocumentSchema } from "../src/index.js";
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
const manifestBody = manifest.body as { product?: string; protocol?: string; seller: { id: string } };
assert(manifestBody.product === "Linguistix", "manifest product");
assert(manifestBody.protocol === "logistix", "manifest protocol");
assert(manifestBody.seller.id === "example-seller", "manifest seller");

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
const createdBody = created.body as { id: string; status: string; amount_total: number };
assert(createdBody.status === "incomplete", "incomplete without email");
assert(createdBody.amount_total === 9000, "2 x 4500");

const updated = await handler({
  method: "POST",
  path: `checkout_sessions/${createdBody.id}`,
  headers: auth,
  body: { buyer: { email: "buyer@example.com", first_name: "Ada" } },
});
assert(updated.status === 200, "update");
assert((updated.body as { status: string }).status === "ready_for_payment", "ready");

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
const secondId = (second.body as { id: string }).id;
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
  seller: { id: "s", name: "S", stripeNetworkProfile: "bp_s" },
  apiMount: "https://tickets.example.com/api/logistix/",
  openapiUrl: "https://tickets.example.com/.well-known/linguistix-openapi.yaml",
  auth: { mode: "published", token: "public-agent-token" },
});
assert(mounted.api.mount === "https://tickets.example.com/api/logistix", "mount slash stripped");
assert(mounted.product === "Linguistix" && mounted.protocol === "logistix", "names");

let rejectedEmptyToken = false;
try {
  buildLinguistixDiscoveryDocument({
    seller: { id: "s", name: "S", stripeNetworkProfile: "bp_s" },
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

console.log("smoke ok");
