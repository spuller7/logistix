# Linguistix

Discovery-first seller protocol for buying event tickets. A buyer asks any chat agent for tickets. The agent finds a Linguistix seller the same way it would find `llms.txt`, follows the open HTTP checkout, and pays with a [Stripe Shared Payment Token](https://docs.stripe.com/agentic-commerce) under the [Agentic Commerce Protocol](https://www.agenticcommerce.dev/).

The product name is **Linguistix**. This repository and the npm package are still named `logistix`. The wire protocol id is `logistix`.

Ticketing platforms install this package, implement the seller adapter, and publish a discovery document. **Open Gate** is the reference first seller. This repo is the protocol and seller library. It does not contain the Open Gate application.

Chat agents call the HTTP API. They do not install this package.

```
Buyer → any agent → discover → HTTP checkout → seller → Stripe
```

| Step | Where it happens |
|------|------------------|
| Discover the seller | `llms.txt`, the event page, then `GET /.well-known/linguistix.json` |
| Read the API | OpenAPI URL in that document |
| Find tickets and check out | HTTP on `api.mount` |
| Pay | Embedded Stripe Payment Element (or wallet) in the chat → Shared Payment Token → `POST …/complete` with `spt_…` |
| Issue tickets | Seller confirms the PaymentIntent and returns the order |

The purchase steps are `TICKET_PURCHASE_FLOW`. The normative detail is [PROTOCOL.md](./PROTOCOL.md).

## Payment collection

The buyer never types a card number, PAN, or CVC into the chat or the model. The chat host collects the payment method in a third-party widget embedded in the chat (Stripe Payment Element, Elements, or a wallet). A redirect to a separate checkout page is not the primary path. 3DS stays in that same widget when possible. A hosted payment URL is a last resort only, and checkout complete still receives an `spt_…` token, never raw card data.

Every discovery document repeats this as `payment.collection`. The seller handler rejects a digit-only card number or CVC in `payment_data.token`.

## Discovery

Agents need no SDK and no prior base URL.

1. The seller's `/llms.txt` links to the discovery document. See [examples/llms.txt](./examples/llms.txt).
2. Each event page points at the same document and includes the event id. See [examples/event-page.html](./examples/event-page.html).
3. The document itself is [examples/well-known/linguistix.json](./examples/well-known/linguistix.json). Schema: [discovery/linguistix.discovery.schema.json](./discovery/linguistix.discovery.schema.json).
4. `api.openapi` is the seller's copy of [openapi/linguistix.openapi.yaml](./openapi/linguistix.openapi.yaml).

Canonical path: `/.well-known/linguistix.json`. A seller may also serve the same JSON at `/.well-known/logistix.json` during the rename.

Conventional API mount: `/api/logistix`. The discovery field `api.mount` is the URL agents call.

## Seller library

Platforms depend on this package. A minimal mount is [examples/seller-stub](./examples/seller-stub).

```ts
import {
  buildLinguistixDiscoveryDocument,
  buildSellerManifest,
  confirmPaymentIntentWithSharedToken,
  createLogistixHandler,
  LINGUISTIX_WELL_KNOWN_PATH,
  type LogistixSellerAdapter,
} from "logistix";
```

Host the object from `buildLinguistixDiscoveryDocument` at `LINGUISTIX_WELL_KNOWN_PATH`. Mount `createLogistixHandler({ adapter, apiKey })` at `api.mount`. On checkout complete, confirm the Shared Payment Token with `confirmPaymentIntentWithSharedToken` before issuing tickets.

`GET` on the mount returns a seller manifest (`buildSellerManifest`) for callers that already know the mount. The well-known file is how they learn that URL.

```json
"logistix": "file:../logistix"
```

Published package name, when you ship it: `logistix`.

## What the package exports

Seller adapter and HTTP handler, checkout helpers, request schemas, discovery builder, and Stripe helpers that **confirm** a granted Shared Payment Token (`confirmPaymentIntentWithSharedToken`, plus `createTestGrantedToken` for seller tests).

Shared Payment Token **issuance** is the paying agent's call to Stripe. The request shape is in [PROTOCOL.md](./PROTOCOL.md#issuing-a-shared-payment-token). This package does not issue tokens.

## Scope

Linguistix is the seller protocol and its discovery files. An earlier draft of this repo also exported an in-process agent client and OpenAI tool definitions, used by a local tester called Tix Tracer. That import path is not part of the protocol.
