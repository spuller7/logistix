# Seller stub

In-memory Linguistix seller. It is a wiring example for the adapter, HTTP handler, and discovery document. It is not the Open Gate application.

`createSampleSeller()` returns:

- `adapter` — `LogistixSellerAdapter` with two sample events
- `handler` — `createLogistixHandler` bound to that adapter and the example bearer token
- `discovery` — the `/.well-known/linguistix.json` body for the same seller

Host `discovery` at the site root (`/.well-known/linguistix.json`). Mount `handler` at `discovery.api.mount`. The handler does not serve the well-known file.

On `completeCheckout`, a production seller calls `confirmPaymentIntentWithSharedToken` before issuing tickets. Pass that call as `capturePayment` if you want the stub to wait for a PaymentIntent status.

```ts
import { confirmPaymentIntentWithSharedToken, type StripeRaw } from "logistix";
import { createSampleSeller } from "./stub.js";

// `stripe` is the seller's Stripe client (structural `rawRequest`).
declare const stripe: StripeRaw;

const { handler, discovery } = createSampleSeller({
  capturePayment: (input) =>
    confirmPaymentIntentWithSharedToken(stripe, {
      amountCents: input.amountCents,
      currency: input.currency,
      sharedPaymentToken: input.sharedPaymentToken,
      receiptEmail: input.receiptEmail,
    }),
});
```

The example token `example-agent-token` is a placeholder public agent credential. Set the handler `apiKey` and the discovery `auth.token` to the same value.
