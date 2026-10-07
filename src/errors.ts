export type LogistixErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "SOLD_OUT"
  | "PROMO_REQUIRED"
  | "INVALID_PROMO"
  | "CHECKOUT_NOT_READY"
  | "CHECKOUT_EXPIRED"
  | "CHECKOUT_COMPLETED"
  | "CHECKOUT_CANCELED"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_DECLINED"
  | "PAYMENT_ACTION_REQUIRED"
  | "SELLER_ERROR"
  | "CONFLICT";

export class LogistixError extends Error {
  readonly code: LogistixErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: LogistixErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LogistixError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function isLogistixError(err: unknown): err is LogistixError {
  return err instanceof LogistixError;
}
