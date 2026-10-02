export interface PaymentCheckoutRequest {
  customerId: string;
  email: string;
  plan: 'pro';
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentSubscriptionEvent {
  customerId: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired' | 'inactive';
  plan: 'free' | 'pro';
  providerCustomerId?: string;
  currentPeriodEnd?: string;
}

/** Provider boundary for future checkout and webhook integrations. The MVP deliberately ships no provider adapter. */
export interface PaymentProvider {
  createCheckout(request: PaymentCheckoutRequest): Promise<{ checkoutUrl: string }>;
  verifyWebhook(payload: Uint8Array, signature: string): Promise<PaymentSubscriptionEvent>;
}
