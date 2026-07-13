/** A saved card on a client profile. Display metadata only — never raw PAN. */
export interface ClientPaymentMethodDTO {
  id: string;
  /** Stripe payment-method id (pm_…). Safe to hold; it is not a secret. */
  stripePaymentMethodId: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  label: string | null;
  /** True when the card's expiry month has already passed. */
  isExpired: boolean;
}

export interface ListClientPaymentMethodsResult {
  methods: ClientPaymentMethodDTO[];
  /** False when Stripe could not be reached and the local mirror was used. */
  synced: boolean;
  /** True once the client has a Stripe customer (needed before adding a card). */
  hasStripeCustomer: boolean;
}
