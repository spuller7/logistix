import { LOGISTIX_VERSION, STRIPE_AGENTIC_API_VERSION } from "./version.js";

/**
 * Seller-side Stripe helpers for Shared Payment Tokens.
 *
 * The paying agent issues the token with Stripe (`POST /v1/shared_payment/issued_tokens`),
 * using the seller profile published in `/.well-known/linguistix.json`. That call is
 * specified in PROTOCOL.md. This module confirms a PaymentIntent with the granted token.
 */

/** Minimal Stripe surface used for Shared Payment Tokens (preview APIs). */
export type StripeRaw = {
  // Stripe SDK overloads rawRequest; keep this structural so both v20 and v22 assign.
  rawRequest: (
    method: string,
    path: string,
    params?: { [key: string]: unknown },
    options?: { apiVersion?: string; headers?: Record<string, string> }
  ) => Promise<unknown>;
};

export type ConfirmWithSptInput = {
  amountCents: number;
  currency: string;
  sharedPaymentToken: string;
  metadata?: Record<string, string>;
  description?: string;
  receiptEmail?: string;
  connectAccountId?: string | null;
  confirm?: boolean;
  applicationFeeAmount?: number;
};

function defaultExpiryUnix() {
  return Math.floor(Date.now() / 1000) + 60 * 30;
}

/**
 * Seller-side test helper: grant this Stripe account an SPT backed by a test PaymentMethod
 * (for example `pm_card_visa`).
 */
export async function createTestGrantedToken(
  stripe: StripeRaw,
  input: {
    paymentMethodId?: string;
    amountCents: number;
    currency: string;
    expiresAtUnix?: number;
  }
): Promise<{ id: string }> {
  const params: Record<string, unknown> = {
    payment_method: input.paymentMethodId ?? "pm_card_visa",
    "usage_limits[currency]": input.currency.toLowerCase(),
    "usage_limits[max_amount]": input.amountCents,
    "usage_limits[expires_at]": input.expiresAtUnix ?? defaultExpiryUnix(),
  };
  return (await stripe.rawRequest(
    "POST",
    "/v1/test_helpers/shared_payment/granted_tokens",
    params,
    { apiVersion: STRIPE_AGENTIC_API_VERSION }
  )) as { id: string };
}

export async function confirmPaymentIntentWithSharedToken(
  stripe: StripeRaw,
  input: ConfirmWithSptInput
): Promise<{ id: string; status: string; client_secret?: string | null }> {
  const params: Record<string, unknown> = {
    amount: input.amountCents,
    currency: input.currency.toLowerCase(),
    confirm: input.confirm !== false,
    "payment_method_data[shared_payment_granted_token]": input.sharedPaymentToken,
    "payment_method_types[0]": "card",
  };
  if (input.description) params.description = input.description;
  if (input.receiptEmail) params.receipt_email = input.receiptEmail;
  if (input.applicationFeeAmount && input.applicationFeeAmount > 0) {
    params.application_fee_amount = input.applicationFeeAmount;
  }
  if (input.metadata) {
    for (const [k, v] of Object.entries(input.metadata)) {
      params[`metadata[${k}]`] = v;
    }
  }

  const options: { apiVersion: string; headers?: Record<string, string> } = {
    apiVersion: STRIPE_AGENTIC_API_VERSION,
  };
  if (input.connectAccountId) {
    options.headers = { "Stripe-Account": input.connectAccountId };
  }

  return (await stripe.rawRequest("POST", "/v1/payment_intents", params, options)) as {
    id: string;
    status: string;
    client_secret?: string | null;
  };
}

export const LOGISTIX_STRIPE_VERSION_HEADER = {
  "Stripe-Version": STRIPE_AGENTIC_API_VERSION,
  "Logistix-Version": LOGISTIX_VERSION,
};
