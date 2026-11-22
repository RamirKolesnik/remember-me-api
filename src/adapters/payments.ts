export interface CheckoutRequest {
  frameId: string
  priceUsd: number
  description: string
  /** The provider's checkout must expire with the hold. */
  expiresAt: Date
}

export interface PaymentEvent {
  frameId: string
  paymentRef: string
}

export interface PaymentProvider {
  readonly configured: boolean
  createCheckout(req: CheckoutRequest): Promise<{ url: string }>
  /** Checks the webhook signature and returns a paid event, or null for events we ignore. */
  parseWebhook(headers: Record<string, unknown>, rawBody: string): Promise<PaymentEvent | null>
}

/** The provider is not chosen yet (see the brief); this stub refuses checkout. */
export function createPayments(provider: string): PaymentProvider {
  if (provider) throw new Error(`Unknown PAYMENT_PROVIDER "${provider}"`)
  return {
    configured: false,
    async createCheckout() {
      throw new Error('Payments are not configured')
    },
    async parseWebhook() {
      throw new Error('Payments are not configured')
    },
  }
}
