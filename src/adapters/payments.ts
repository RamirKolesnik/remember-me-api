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
  readonly name: string
  readonly configured: boolean
  createCheckout(req: CheckoutRequest): Promise<{ url: string }>
  /** Checks the webhook signature and returns a paid event, or null for events we ignore. */
  parseWebhook(headers: Record<string, unknown>, rawBody: string): Promise<PaymentEvent | null>
}

const notConfigured: PaymentProvider = {
  name: 'none',
  configured: false,
  async createCheckout() {
    throw new Error('Payments are not configured')
  },
  async parseWebhook() {
    throw new Error('Payments are not configured')
  },
}

/**
 * Test payments: checkout is a page on this API with "Pay" and "Cancel"
 * buttons (see routes/sandbox.ts). No money moves. Never enable in production.
 */
function sandbox(publicUrl: string): PaymentProvider {
  return {
    name: 'sandbox',
    configured: true,
    async createCheckout(req) {
      return { url: `${publicUrl}/sandbox/checkout/${req.frameId}` }
    },
    async parseWebhook() {
      return null // the sandbox activates frames directly, no webhooks
    },
  }
}

/** The real provider is not chosen yet (see the brief). */
export function createPayments(provider: string, publicUrl: string): PaymentProvider {
  if (!provider) return notConfigured
  if (provider === 'sandbox') return sandbox(publicUrl)
  throw new Error(`Unknown PAYMENT_PROVIDER "${provider}"`)
}
