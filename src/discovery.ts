import { z } from "zod";
import { defaultCapabilities, stripeCardHandler } from "./checkout.js";
import type { SellerManifest } from "./types.js";
import {
  ACP_API_VERSION,
  LOGISTIX_VERSION,
  PRODUCT_NAME,
  PROTOCOL_NAME,
} from "./version.js";

/** Canonical discovery document. Agents fetch this like `llms.txt`, with no package install. */
export const LINGUISTIX_WELL_KNOWN_PATH = "/.well-known/linguistix.json";

/**
 * Optional alias while the package id is still `logistix`.
 * When a seller serves it, the body must be the same document as `linguistix.json`.
 */
export const LOGISTIX_WELL_KNOWN_ALIAS_PATH = "/.well-known/logistix.json";

/** Recommended place to host the seller's copy of the OpenAPI description. */
export const LINGUISTIX_OPENAPI_WELL_KNOWN_PATH = "/.well-known/linguistix-openapi.yaml";

/** Conventional HTTP mount for `createLogistixHandler`. Sellers may choose another path. */
export const CONVENTIONAL_API_MOUNT_PATH = "/api/logistix";

const absoluteHttpUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "Expected an absolute http(s) URL");

export const linguistixDiscoveryDocumentSchema = z
  .object({
    product: z.literal(PRODUCT_NAME),
    protocol: z.literal(PROTOCOL_NAME),
    protocol_version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    acp_version: z.string().min(1),
    seller: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      stripe_network_profile: z.string().min(1).optional(),
      stripe_account: z.string().min(1).optional(),
    }),
    api: z.object({
      mount: absoluteHttpUrl,
      openapi: absoluteHttpUrl,
    }),
    auth: z.object({
      type: z.enum(["bearer", "none"]),
      version_header: z.literal("Logistix-Version"),
      header: z.literal("Authorization").optional(),
      scheme: z.literal("Bearer").optional(),
      mode: z.enum(["published", "out_of_band", "none"]),
      token: z.string().min(1).optional(),
      instructions: z.string().min(1).optional(),
    }),
    payment: z.object({
      provider: z.literal("stripe"),
      method: z.literal("shared_payment_token"),
      handler_id: z.literal("card_tokenized"),
      handler_name: z.literal("dev.acp.tokenized.card"),
      requires_delegate_payment: z.literal(true),
      accepted_brands: z.array(z.string().min(1)).min(1),
      stripe_network_profile: z.string().min(1).optional(),
      stripe_account: z.string().min(1).optional(),
    }),
    capabilities: z.object({
      search: z.boolean(),
      ticket_types: z.boolean(),
      checkout: z.boolean(),
      agentic_payment: z.boolean(),
      fulfillment: z.array(z.literal("digital")).min(1),
    }),
  })
  .superRefine((doc, ctx) => {
    if (doc.auth.mode === "none") {
      if (doc.auth.type !== "none") {
        ctx.addIssue({
          code: "custom",
          path: ["auth", "type"],
          message: "auth.type must be none when auth.mode is none",
        });
      }
      if (doc.auth.token) {
        ctx.addIssue({
          code: "custom",
          path: ["auth", "token"],
          message: "omit auth.token when auth.mode is none",
        });
      }
    }

    if (doc.auth.mode === "published") {
      if (doc.auth.type !== "bearer" || !doc.auth.token) {
        ctx.addIssue({
          code: "custom",
          path: ["auth", "token"],
          message: "published auth requires type bearer and a token",
        });
      }
      if (doc.auth.header !== "Authorization" || doc.auth.scheme !== "Bearer") {
        ctx.addIssue({
          code: "custom",
          path: ["auth", "header"],
          message: "published auth requires Authorization: Bearer",
        });
      }
    }

    if (doc.auth.mode === "out_of_band") {
      if (doc.auth.type !== "bearer" || !doc.auth.instructions) {
        ctx.addIssue({
          code: "custom",
          path: ["auth", "instructions"],
          message: "out_of_band auth requires type bearer and instructions",
        });
      }
      if (doc.auth.token) {
        ctx.addIssue({
          code: "custom",
          path: ["auth", "token"],
          message: "omit auth.token when auth.mode is out_of_band",
        });
      }
      if (doc.auth.header !== "Authorization" || doc.auth.scheme !== "Bearer") {
        ctx.addIssue({
          code: "custom",
          path: ["auth", "header"],
          message: "out_of_band auth requires Authorization: Bearer",
        });
      }
    }

    if (doc.capabilities.agentic_payment && !doc.payment.stripe_network_profile) {
      ctx.addIssue({
        code: "custom",
        path: ["payment", "stripe_network_profile"],
        message: "stripe_network_profile is required when agentic_payment is true",
      });
    }

    if (
      doc.seller.stripe_network_profile &&
      doc.payment.stripe_network_profile &&
      doc.seller.stripe_network_profile !== doc.payment.stripe_network_profile
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["payment", "stripe_network_profile"],
        message: "seller.stripe_network_profile and payment.stripe_network_profile must match",
      });
    }

    if (
      doc.seller.stripe_account &&
      doc.payment.stripe_account &&
      doc.seller.stripe_account !== doc.payment.stripe_account
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["payment", "stripe_account"],
        message: "seller.stripe_account and payment.stripe_account must match",
      });
    }
  });

export type LinguistixDiscoveryDocument = z.infer<typeof linguistixDiscoveryDocumentSchema>;

export type DiscoveryAuthInput =
  | { mode: "none" }
  | { mode: "published"; token: string; instructions?: string }
  | { mode: "out_of_band"; instructions: string };

export type BuildLinguistixDiscoveryInput = {
  seller: {
    id: string;
    name: string;
    stripeNetworkProfile?: string;
    stripeAccount?: string;
  };
  /** Absolute URL of the handler mount, without a trailing slash. */
  apiMount: string;
  /** Absolute URL of the OpenAPI document for that mount. */
  openapiUrl: string;
  auth: DiscoveryAuthInput;
  acceptedBrands?: string[];
  protocolVersion?: string;
  acpVersion?: string;
  capabilities?: {
    search?: boolean;
    ticket_types?: boolean;
    checkout?: boolean;
    agentic_payment?: boolean;
    fulfillment?: Array<"digital">;
  };
};

export type BuildSellerManifestInput = {
  seller: BuildLinguistixDiscoveryInput["seller"];
  acceptedBrands?: string[];
  protocolVersion?: string;
  acpVersion?: string;
  capabilities?: BuildLinguistixDiscoveryInput["capabilities"];
};

function normalizeMount(mount: string): string {
  let url: URL;
  try {
    url = new URL(mount);
  } catch {
    throw new Error("apiMount must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("apiMount must be an absolute http(s) URL");
  }
  if (url.search || url.hash) {
    throw new Error("apiMount must not include a query string or hash");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

function capabilityFlags(input: BuildLinguistixDiscoveryInput["capabilities"]) {
  return {
    search: input?.search ?? true,
    ticket_types: input?.ticket_types ?? true,
    checkout: input?.checkout ?? true,
    agentic_payment: input?.agentic_payment ?? true,
    fulfillment: input?.fulfillment ?? (["digital"] as Array<"digital">),
  };
}

function authDocument(auth: DiscoveryAuthInput): LinguistixDiscoveryDocument["auth"] {
  if (auth.mode === "none") {
    return {
      type: "none",
      mode: "none",
      version_header: "Logistix-Version",
    };
  }
  if (auth.mode === "published") {
    return {
      type: "bearer",
      mode: "published",
      header: "Authorization",
      scheme: "Bearer",
      version_header: "Logistix-Version",
      token: auth.token,
      ...(auth.instructions ? { instructions: auth.instructions } : {}),
    };
  }
  return {
    type: "bearer",
    mode: "out_of_band",
    header: "Authorization",
    scheme: "Bearer",
    version_header: "Logistix-Version",
    instructions: auth.instructions,
  };
}

export function buildLinguistixDiscoveryDocument(
  input: BuildLinguistixDiscoveryInput
): LinguistixDiscoveryDocument {
  const capabilities = capabilityFlags(input.capabilities);
  const brands = input.acceptedBrands ?? stripeCardHandler().config.accepted_brands;
  const draft = {
    product: PRODUCT_NAME,
    protocol: PROTOCOL_NAME,
    protocol_version: input.protocolVersion ?? LOGISTIX_VERSION,
    acp_version: input.acpVersion ?? ACP_API_VERSION,
    seller: {
      id: input.seller.id,
      name: input.seller.name,
      ...(input.seller.stripeNetworkProfile
        ? { stripe_network_profile: input.seller.stripeNetworkProfile }
        : {}),
      ...(input.seller.stripeAccount ? { stripe_account: input.seller.stripeAccount } : {}),
    },
    api: {
      mount: normalizeMount(input.apiMount),
      openapi: input.openapiUrl,
    },
    auth: authDocument(input.auth),
    payment: {
      provider: "stripe" as const,
      method: "shared_payment_token" as const,
      handler_id: "card_tokenized" as const,
      handler_name: "dev.acp.tokenized.card" as const,
      requires_delegate_payment: true as const,
      accepted_brands: brands,
      ...(input.seller.stripeNetworkProfile
        ? { stripe_network_profile: input.seller.stripeNetworkProfile }
        : {}),
      ...(input.seller.stripeAccount ? { stripe_account: input.seller.stripeAccount } : {}),
    },
    capabilities,
  };

  const parsed = linguistixDiscoveryDocumentSchema.safeParse(draft);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid Linguistix discovery document: ${detail}`);
  }
  return parsed.data;
}

export function buildSellerManifest(input: BuildSellerManifestInput): SellerManifest {
  const capabilities = capabilityFlags(input.capabilities);
  if (capabilities.agentic_payment && !input.seller.stripeNetworkProfile) {
    throw new Error("stripeNetworkProfile is required when agentic_payment is true");
  }

  const handler = stripeCardHandler({
    merchantId: input.seller.stripeAccount,
    networkProfile: input.seller.stripeNetworkProfile,
  });
  if (input.acceptedBrands) {
    handler.config.accepted_brands = input.acceptedBrands;
  }

  return {
    protocol: PROTOCOL_NAME,
    product: PRODUCT_NAME,
    version: input.protocolVersion ?? LOGISTIX_VERSION,
    acp_version: input.acpVersion ?? ACP_API_VERSION,
    seller: {
      id: input.seller.id,
      name: input.seller.name,
      ...(input.seller.stripeNetworkProfile
        ? { stripe_network_profile: input.seller.stripeNetworkProfile }
        : {}),
      ...(input.seller.stripeAccount ? { stripe_account: input.seller.stripeAccount } : {}),
    },
    capabilities,
    endpoints: {
      events: "events",
      checkout_sessions: "checkout_sessions",
    },
    payment: capabilities.agentic_payment
      ? defaultCapabilities(handler).payment
      : { handlers: [] },
  };
}
