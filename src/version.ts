/** Wire protocol version (YYYY-MM-DD). Sent as the `Logistix-Version` header. */
export const LOGISTIX_VERSION = "2026-08-25";

/** Stripe Agentic Commerce / Shared Payment Token preview API version. */
export const STRIPE_AGENTIC_API_VERSION = "2026-04-22.preview";

/** ACP checkout API version Linguistix checkout sessions align with. */
export const ACP_API_VERSION = "2026-01-30";

/**
 * Wire protocol id. Discovery documents, seller manifests, and headers use this value.
 * The product name is Linguistix; the npm package id remains `logistix`.
 */
export const PROTOCOL_NAME = "logistix" as const;

/** Product name. Use this in discovery documents and human-facing copy. */
export const PRODUCT_NAME = "Linguistix" as const;

export const PROTOCOL_DISPLAY_NAME = PRODUCT_NAME;
