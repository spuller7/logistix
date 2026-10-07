# Logistix protocol

Logistix is the standard way **ticketing platforms** expose events and inventory, and the standard **tool surface** chat agents call to find tickets, select types, and buy.

Payments use [Stripe Agentic Commerce](https://docs.stripe.com/agentic-commerce): the agent issues a **Shared Payment Token (SPT)** to the seller’s Stripe profile; the seller confirms a PaymentIntent with that token. Checkout sessions follow the [Agentic Commerce Protocol](https://www.agenticcommerce.dev/) lifecycle (create → update → complete).

## Ticket purchase flow

```
Buyer (chat)  →  Agent (Tix Tracer)  →  Logistix  →  Seller (Open Gate)  →  Stripe
```

| Step | Agent tool | Seller HTTP | Stripe |
|------|------------|-------------|--------|
| 1 Discover | `logistix_search_events` / `logistix_get_event` | `GET /events`, `GET /events/{id}` | — |
| 2 Select types | `logistix_list_ticket_types` | `GET /events/{id}/ticket-types` | — |
| 3 Create checkout | `logistix_create_checkout` | `POST /checkout_sessions` | — |
| 4 Buyer + qty | `logistix_update_checkout` | `POST /checkout_sessions/{id}` | — |
| 5 Collect PM + issue SPT | `logistix_complete_purchase` | Seller profile on `GET /` | `POST /v1/shared_payment/issued_tokens` |
| 6 Capture + issue tickets | (same tool) | `POST /checkout_sessions/{id}/complete` | PaymentIntent + `shared_payment_granted_token` |
| 7 Confirm | `logistix_get_checkout` | `GET /checkout_sessions/{id}` | webhooks (`payment_intent.succeeded`) |

Fulfillment is always **digital** (email + wallet). No shipping address.

Checkout `status`:

- `incomplete` — missing buyer email or inventory/promo issues
- `ready_for_payment` — totals locked, inventory held
- `processing` — payment submitted
- `completed` — order created; `order.permalink_url` present
- `canceled` — hold released

### Complete payload (agent → seller)

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

The seller creates a PaymentIntent:

```
payment_method_data[shared_payment_granted_token]=spt_...
confirm=true
Stripe-Version: 2026-04-22.preview
```

If the SPT requires 3DS, the agent handles `shared_payment.issued_token.requires_action` in its own UI (buyer never leaves the chat agent).

## Seller mount

Implement `LogistixSellerAdapter` and serve:

```
GET  /api/logistix
GET  /api/logistix/events
GET  /api/logistix/events/{id}
GET  /api/logistix/events/{id}/ticket-types
POST /api/logistix/checkout_sessions
GET  /api/logistix/checkout_sessions/{id}
POST /api/logistix/checkout_sessions/{id}
POST /api/logistix/checkout_sessions/{id}/complete
POST /api/logistix/checkout_sessions/{id}/cancel
```

Auth: `Authorization: Bearer <LOGISTIX_API_KEY>`  
Version: `Logistix-Version: 2026-08-25`

## Agent import

```ts
import { LogistixClient, logistixOpenAITools, LOGISTIX_AGENT_SYSTEM_PROMPT } from "logistix";

const client = new LogistixClient({
  baseUrl: process.env.LOGISTIX_OPEN_GATE_BASE_URL!,
  apiKey: process.env.LOGISTIX_API_KEY,
});
```

Register `logistixOpenAITools` (or the AI SDK wrappers) so the model can call the flow above.
