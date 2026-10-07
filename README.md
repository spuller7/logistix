# Logistix

Importable protocol for event ticket discovery and **agentic purchase**. Ticketing platforms implement the seller adapter; chat agents import the client + tools.

See [PROTOCOL.md](./PROTOCOL.md) for the purchase flow and [Stripe Agentic Commerce](https://docs.stripe.com/agentic-commerce) for Shared Payment Tokens.

## Install

From sibling apps in this workspace:

```json
"logistix": "file:../logistix"
```

```ts
import {
  LogistixClient,
  createLogistixHandler,
  logistixOpenAITools,
  TICKET_PURCHASE_FLOW,
} from "logistix";
```

## Packages that use it

| App | Role |
|-----|------|
| **Open Gate** | Seller — mounts `/api/logistix`, holds inventory, captures SPT, issues tickets |
| **Tix Tracer** | Agent — Tracer tools call Logistix to buy from Open Gate |
