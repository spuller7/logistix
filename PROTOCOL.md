# Linguistix protocol

Linguistix is how a ticketing platform lets any chat agent buy primary-market tickets. The agent discovers the seller over HTTP, checks out against an OpenAPI description, and pays with a Stripe Shared Payment Token. The seller confirms that token and issues digital tickets.

The product name is **Linguistix**. The wire protocol id, the `Logistix-Version` header, and the npm package id are **`logistix`**.

```
Buyer → any agent → discover → HTTP checkout → seller (Open Gate and others) → Stripe
```

Open Gate is the reference first seller: it holds inventory, mounts this API, captures the Shared Payment Token, and issues tickets. This repository is the protocol and the seller library. It does not contain the Open Gate application.

Payments use [Stripe Agentic Commerce](https://docs.stripe.com/agentic-commerce). Checkout sessions follow the [Agentic Commerce Protocol](https://www.agenticcommerce.dev/) lifecycle: create, update, complete.

## Roles

| Role | Responsibility |
|------|----------------|
| Buyer | Asks for tickets in a chat agent and confirms the event, ticket type, quantity, and total. |
| Agent | Discovers the seller, calls the HTTP API, collects a payment method in an embedded third-party widget, and issues a Shared Payment Token with Stripe. |
| Seller | Publishes discovery, implements `LogistixSellerAdapter`, mounts the handler, confirms the PaymentIntent, and issues tickets. |
| Stripe | Issues the Shared Payment Token to the agent and accepts the seller's PaymentIntent. |

The agent speaks HTTP and Stripe. It does not import this package.

## Purchase flow

`TICKET_PURCHASE_FLOW` in the package lists the same steps. HTTP paths except discovery are relative to `api.mount`.

| Step | What happens | Call |
|------|----------------|------|
| 1 | Find the seller | `GET /.well-known/linguistix.json` |
| 2 | Search and read an event | `GET /events`, `GET /events/{id}` |
| 3 | Choose ticket types | `GET /events/{id}/ticket-types` |
| 4 | Open checkout and hold inventory | `POST /checkout_sessions` |
| 5 | Attach the buyer; lock totals | `POST /checkout_sessions/{id}` |
| 6 | Collect a payment method in an embedded widget, then issue a Shared Payment Token | Stripe `POST /v1/shared_payment/issued_tokens` |
| 7 | Seller captures payment and issues tickets | `POST /checkout_sessions/{id}/complete` |
| 8 | Read the order permalink | `GET /checkout_sessions/{id}` |

Fulfillment is digital (email and wallet). Sellers do not collect a shipping address.

Cancel an open hold with `POST /checkout_sessions/{id}/cancel`.

### Checkout status

| Status | Meaning |
|--------|---------|
| `incomplete` | Missing buyer email, or inventory / promo rules are not satisfied. |
| `ready_for_payment` | Totals are locked and inventory is held. |
| `processing` | Payment has been submitted and is not final. |
| `completed` | Order exists. `order.permalink_url` is present. |
| `canceled` | Hold released. |
| `requires_escalation` | The seller needs a person to continue. |

## Discovery

Agents find a seller without a package, the same way they find `llms.txt`.

### Well-known document

Canonical URL:

```
GET /.well-known/linguistix.json
```

Optional alias, same JSON body, while the package id is still `logistix`:

```
GET /.well-known/logistix.json
```

The schema is [discovery/linguistix.discovery.schema.json](./discovery/linguistix.discovery.schema.json). An example for Open Gate is [examples/well-known/linguistix.json](./examples/well-known/linguistix.json). Sellers can build the object with `buildLinguistixDiscoveryDocument`.

Agents ignore unknown properties. Required fields:

| Field | Meaning |
|-------|---------|
| `product` | `"Linguistix"` |
| `protocol` | `"logistix"` |
| `protocol_version` | Date the seller echoes as `Logistix-Version`. Current: `2026-08-25`. |
| `acp_version` | ACP checkout version. Current alignment: `2026-01-30`. |
| `seller.id`, `seller.name` | Seller identity. Same values as `GET {mount}/`. |
| `seller.stripe_network_profile` | Stripe network business profile. Required when `capabilities.agentic_payment` is true. |
| `seller.stripe_account` | Stripe account id when the seller publishes one. |
| `api.mount` | Absolute URL of the HTTP API, no trailing slash. Conventional path: `/api/logistix`. |
| `api.openapi` | Absolute URL of the OpenAPI document for that mount. |
| `auth` | How to call the mount. See below. |
| `payment` | Stripe Shared Payment Token acceptance: provider `stripe`, method `shared_payment_token`, handler `card_tokenized` / `dev.acp.tokenized.card`, accepted card brands, and the same Stripe profile as `seller`. `payment.collection` states how the agent collects the payment method. |
| `capabilities` | `search`, `ticket_types`, `checkout`, `agentic_payment`, and `fulfillment` (today only `digital`). |

`buildSellerManifest` returns the in-band manifest for `GET {mount}/`. `seller`, `protocol_version` / `version`, capabilities, and the Stripe profile must match the well-known document. Manifest `endpoints` are mount-relative paths (`events`, `checkout_sessions`). The absolute mount lives only in the well-known file, because that file is what an agent has before it knows the mount.

#### Auth

| `auth.mode` | Agent behavior |
|-------------|----------------|
| `published` | Send `Authorization: Bearer <auth.token>` on every request. The token is a public checkout credential for agents, not an admin secret. `auth.type` is `bearer`. |
| `out_of_band` | Obtain a bearer token using `auth.instructions`. The document does not contain the token. |
| `none` | Call the mount without a credential. `auth.type` is `none`. Suitable for local development (`allowUnauthenticatedDev` on the handler). |

Every mode sets `auth.version_header` to `Logistix-Version`. Callers should send that header with `protocol_version`. Servers echo their version on responses whether or not the request header is present.

The handler compares the bearer token to the seller's configured `apiKey`. For `published`, that key and `auth.token` are the same value.

### `llms.txt`

Put a link to the discovery document in the site's `/llms.txt` so an agent that only knows the site can find checkout. [llmstxt.org](https://llmstxt.org/) is the file convention. Example: [examples/llms.txt](./examples/llms.txt).

```markdown
# Open Gate

> Primary-market tickets sold through Linguistix. Any chat agent can check out over HTTP after reading the discovery document.

## Buy tickets

- [Linguistix discovery](https://tickets.example.com/.well-known/linguistix.json): API mount, protocol version, auth, Stripe seller profile, OpenAPI URL, and `payment.collection` (embedded widget, then Shared Payment Token; no card numbers in chat).
```

### Event pages

Each event page should point at the discovery document and name the event id the HTTP API uses. Recommended marker:

```html
<link
  rel="describedby"
  type="application/json"
  href="https://tickets.example.com/.well-known/linguistix.json"
  title="Linguistix"
/>
<script type="application/json" id="linguistix-event">
  {
    "discovery": "https://tickets.example.com/.well-known/linguistix.json",
    "event_id": "evt_harbor_lights"
  }
</script>
```

Example: [examples/event-page.html](./examples/event-page.html). When `event_id` is present, the agent can call `GET /events/{event_id}` directly. Otherwise it searches with `GET /events?q=`.

## OpenAPI

The seller HTTP API is [openapi/linguistix.openapi.yaml](./openapi/linguistix.openapi.yaml) (OpenAPI 3.1). It matches `createLogistixHandler`.

Sellers host a copy at `api.openapi`. Recommended path: `/.well-known/linguistix-openapi.yaml`. Set that copy's server URL to `api.mount`. Paths in the file are relative to the mount.

Request header `Logistix-Version` is recommended. Response header `Logistix-Version` is always set. `Authorization: Bearer` is required when discovery `auth.mode` is `published` or `out_of_band`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Seller manifest |
| `GET` | `/events` | Search. Query: `q`, `city`, `starts_after`, `starts_before`, `limit` (1–50) |
| `GET` | `/events/{id}` | One event |
| `GET` | `/events/{id}/ticket-types` | Prices in cents and remaining inventory |
| `POST` | `/checkout_sessions` | Create checkout. `201` |
| `GET` | `/checkout_sessions/{id}` | Read checkout, including `order` after completion |
| `POST` | `/checkout_sessions/{id}` | Update line items or buyer |
| `POST` | `/checkout_sessions/{id}/complete` | Submit the Shared Payment Token and issue tickets |
| `POST` | `/checkout_sessions/{id}/cancel` | Release the hold |

Search returns `{ "events": [ ... ] }`. Ticket types return `{ "ticket_types": [ ... ] }`. A search hit may omit `ticket_types`; the ticket-types route is the inventory read.

Errors:

```json
{ "error": { "code": "SOLD_OUT", "message": "General admission does not have enough inventory" } }
```

Codes: `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `SOLD_OUT`, `PROMO_REQUIRED`, `INVALID_PROMO`, `CHECKOUT_NOT_READY`, `CHECKOUT_EXPIRED`, `CHECKOUT_COMPLETED`, `CHECKOUT_CANCELED`, `PAYMENT_REQUIRED`, `PAYMENT_DECLINED`, `PAYMENT_ACTION_REQUIRED`, `SELLER_ERROR`, `CONFLICT`.

## Checkout body

Create:

```json
{
  "event_id": "evt_harbor_lights",
  "items": [{ "ticket_type_id": "tt_ga", "quantity": 2 }],
  "buyer": { "email": "buyer@example.com", "first_name": "Ada" }
}
```

`buyer.email` may arrive on create or on a later update. A promo-gated ticket type includes `promo_code` on the line. The seller decides promo validity and returns `PROMO_REQUIRED` or `INVALID_PROMO`.

Complete (agent → seller):

```json
{
  "payment_data": {
    "token": "spt_...",
    "provider": "stripe",
    "handler_id": "card_tokenized"
  },
  "buyer": { "email": "buyer@example.com", "first_name": "Ada" }
}
```

`payment_data.token` is the Shared Payment Token id (`spt_…`). The seller rejects a card number or CVC in `token` or `payment_method` with `VALIDATION_ERROR`. `payment_data.payment_method` is a dev-only Stripe PaymentMethod id (`pm_…`) for sellers whose tests cannot mint an SPT. Live checkout sends the token.

The completed session includes `order.order_number`, `order.permalink_url`, and `order.tickets`.

## Payment collection

These rules are normative. Discovery publishes them on every seller as `payment.collection` (`LINGUISTIX_PAYMENT_COLLECTION`). The OpenAPI description repeats them. Agents follow this sequence: embedded widget, then Shared Payment Token, then `POST …/complete`.

1. The buyer must never enter a card number, PAN, or CVC into the model or as free text in the chat. The agent must not ask for those values, parse them out of a message, or place them in any Linguistix field.
2. The chat host collects the payment method with a third-party payment UI embedded in the chat interface. Examples: Stripe Payment Element, Stripe Elements, and wallets. That embedded widget is the primary path.
3. A redirect to a separate checkout page is not the primary path.
4. The host issues a Stripe Shared Payment Token (or the Stripe equivalent for this flow) to `payment.stripe_network_profile`. `POST /checkout_sessions/{id}/complete` receives `payment_data` with that `spt_…` token. The seller never receives raw card data.
5. When Stripe returns `requires_action` (including 3DS), the host presents it inside the same embedded widget when the widget can do so.
6. An external `payment_url` or other hosted payment page is a last resort, only when the chat cannot embed a widget. After the buyer finishes on that page, the host still completes Linguistix with an `spt_…` token. The seller API does not return a `payment_url`, and complete does not accept one.

`payment.collection` values:

| Field | Value | Meaning |
|-------|-------|---------|
| `cardholder_data_in_chat` | `forbidden` | No PAN or CVC in the model or in chat text. |
| `primary_ui` | `embedded_third_party` | Third-party payment UI embedded in the chat. |
| `widgets` | `stripe_payment_element`, `stripe_elements`, `wallet` | Acceptable embedded widgets. |
| `redirect_to_checkout_page` | `not_primary` | A new checkout page is not the primary path. |
| `requires_action` | `same_embedded_widget` | 3DS stays in that widget when possible. |
| `hosted_payment_url` | `last_resort` | Hosted link only if a widget cannot be embedded. |
| `seller_receives` | `shared_payment_token` | Complete carries `spt_…` only. |
| `instructions` | string | The same rules in one paragraph. |

## Issuing a Shared Payment Token

Issuance is the paying agent's request to Stripe, using the profile from discovery, after the embedded widget has produced a PaymentMethod. This package does not issue tokens.

The host collects that PaymentMethod in the embedded widget, then:

```
POST /v1/shared_payment/issued_tokens
Stripe-Version: 2026-04-22.preview
```

| Parameter | Source |
|-----------|--------|
| `payment_method` | PaymentMethod id from the embedded widget. Never a PAN or CVC. |
| `seller_details[network_business_profile]` | `payment.stripe_network_profile` |
| `usage_limits[currency]` | Checkout `currency` |
| `usage_limits[max_amount]` | Checkout `amount_total` in cents |
| `usage_limits[expires_at]` | Unix expiry the agent chooses (a 30-minute window is a reasonable default) |
| `return_url` | Optional. Use it only when the embedded widget cannot finish authentication in place. It is not a substitute for the in-chat widget. |

The response id (`spt_…`) is `payment_data.token` on complete. If Stripe returns `shared_payment.issued_token.requires_action`, the host finishes 3DS inside the same embedded widget when possible. The buyer stays in the chat. A hosted payment URL is only the last resort described above.

Stripe's preview API can move. `STRIPE_AGENTIC_API_VERSION` in this package (`2026-04-22.preview`) is the version seller confirm calls use. Agents should follow current Stripe Agentic Commerce docs if issuance parameters change, and still send an `spt_…` token the seller can confirm.

## Seller confirmation

On `POST /checkout_sessions/{id}/complete` the seller creates a PaymentIntent:

```
POST /v1/payment_intents
Stripe-Version: 2026-04-22.preview

amount=<amount_total>
currency=<currency>
confirm=true
payment_method_data[shared_payment_granted_token]=spt_...
payment_method_types[0]=card
```

`confirmPaymentIntentWithSharedToken` performs that call. Pass `connectAccountId` when the charge is on a connected account (`Stripe-Account`). Issue tickets only after the PaymentIntent is in a capturable or succeeded state. If Stripe still needs buyer authentication, respond with `PAYMENT_ACTION_REQUIRED` and leave the checkout uncompleted so the host can finish 3DS in the embedded widget and retry.

Local seller tests can mint a granted token without an agent via `createTestGrantedToken` (`POST /v1/test_helpers/shared_payment/granted_tokens`, default PaymentMethod `pm_card_visa`).

`LOGISTIX_STRIPE_VERSION_HEADER` carries `Stripe-Version` and `Logistix-Version` for sellers that set headers themselves.

## Seller implementation

1. Implement `LogistixSellerAdapter` (`getManifest`, `searchEvents`, `getEvent`, `listTicketTypes`, `createCheckout`, `getCheckout`, `updateCheckout`, `completeCheckout`, `cancelCheckout`).
2. Mount `createLogistixHandler({ adapter, apiKey })` at `api.mount`. The handler receives the path **under** the mount (`events`, `checkout_sessions/cs_1/complete`).
3. Serve `buildLinguistixDiscoveryDocument(...)` at `/.well-known/linguistix.json` with `Content-Type: application/json`.
4. Serve the OpenAPI file at `api.openapi`.
5. Link both from `/llms.txt` and from event pages.
6. On complete, call `confirmPaymentIntentWithSharedToken`, then persist the order and tickets.

Checkout helpers for adapters: `deriveCheckoutStatus`, `buildTotals`, `amountTotalFromTotals`, `digitalFulfillmentOption`, `stripeCardHandler`, `defaultCapabilities`, `assertMutable`. Request bodies are validated by the handler with the exported Zod schemas before the adapter runs. Search queries with a non-integer `limit` or a `limit` outside 1–50 return `VALIDATION_ERROR`.

`allowUnauthenticatedDev: true` with no `apiKey` skips the bearer check. Pair that with discovery `auth.mode: "none"` only on a local mount.

A generic in-memory mount is [examples/seller-stub](./examples/seller-stub). Open Gate remains the reference production seller and lives in its own application.

## Versioning

| Constant | Value | Where it appears |
|----------|-------|------------------|
| `LOGISTIX_VERSION` | `2026-08-25` | `Logistix-Version`, discovery `protocol_version`, manifest `version` |
| `ACP_API_VERSION` | `2026-01-30` | Discovery `acp_version`, manifest `acp_version` |
| `STRIPE_AGENTIC_API_VERSION` | `2026-04-22.preview` | Seller Stripe-Version on confirm |
| `PROTOCOL_NAME` | `logistix` | Discovery `protocol`, manifest `protocol` |
| `PRODUCT_NAME` | `Linguistix` | Discovery `product`, manifest `product` |

## Earlier agent import

An earlier draft of this repository exported `LogistixClient`, OpenAI tool definitions, and an agent system prompt. A local tester called Tix Tracer imported them. Chat agents are not expected to install the package, and those exports are not part of Linguistix. The HTTP API, discovery document, and seller confirm helpers are the protocol.
