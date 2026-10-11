/**
 * PayPal REST client for Sonar Desk: Orders v2 (brief checkout), captures refunds (the accuracy guarantee) and
 * webhook signature checks. Sandbox unless PAYPAL_ENV=live. Server only: the secret never reaches the browser.
 * `fetchImpl` is injectable so the tests run without the network.
 */

export interface PayPalConfig { clientId: string; clientSecret: string; env: 'sandbox' | 'live'; webhookId?: string }
type Fetch = typeof fetch;

export class PayPalError extends Error {
  constructor(public status: number, public issue: string, message: string, public debugId?: string) { super(message); }
}

export function paypalConfig(env: NodeJS.ProcessEnv = process.env): PayPalConfig | null {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return null;
  return { clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, env: env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox', webhookId: env.PAYPAL_WEBHOOK_ID };
}

export const apiBase = (c: PayPalConfig) => (c.env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

/** Amounts are strings with two decimals, as PayPal wants them. */
export const usd = (cents: number) => (Math.round(cents) / 100).toFixed(2);

export interface OrderLink { href: string; rel: string; method?: string }
export interface Order {
  id: string; status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
  links?: OrderLink[];
  purchase_units?: Array<{
    reference_id?: string; custom_id?: string; amount?: { currency_code: string; value: string };
    payments?: { captures?: Array<{ id: string; status: string; amount: { currency_code: string; value: string }; custom_id?: string }> };
  }>;
  payer?: { payer_id?: string; email_address?: string };
}
export interface Refund { id: string; status: 'CANCELLED' | 'FAILED' | 'PENDING' | 'COMPLETED'; amount?: { currency_code: string; value: string } }

export function client(cfg: PayPalConfig, fetchImpl: Fetch = fetch) {
  let tok: { value: string; exp: number } | null = null;

  async function token(): Promise<string> {
    if (tok && tok.exp > Date.now() + 60_000) return tok.value;
    const res = await fetchImpl(`${apiBase(cfg)}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !j.access_token) throw new PayPalError(res.status, 'AUTH', j.error_description ?? 'PayPal auth failed');
    tok = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 300) * 1000 };
    return tok.value;
  }

  async function call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    // PayPal-Request-Id makes a retried create/capture/refund return the first result instead of doing it twice
    if (idempotencyKey) headers['PayPal-Request-Id'] = idempotencyKey;
    const res = await fetchImpl(`${apiBase(cfg)}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const j = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const issue = j.details?.[0]?.issue ?? j.name ?? 'ERROR';
      throw new PayPalError(res.status, issue, j.details?.[0]?.description ?? j.message ?? `PayPal ${method} ${path} -> ${res.status}`, j.debug_id);
    }
    return j as T;
  }

  return {
    token,
    /** One brief for one market. The price comes from the server, never from the browser. */
    createOrder(o: { referenceId: string; customId: string; description: string; cents: number; requestId: string }) {
      return call<Order>('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: o.referenceId, custom_id: o.customId.slice(0, 127), description: o.description.slice(0, 127), amount: { currency_code: 'USD', value: usd(o.cents) } }],
        payment_source: { paypal: { experience_context: { brand_name: 'Sonar Desk', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } },
      }, o.requestId);
    },
    getOrder: (id: string) => call<Order>('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`),
    captureOrder: (id: string) => call<Order>('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, `capture-${id}`),
    refundCapture(captureId: string, note: string, cents?: number) {
      return call<Refund>('POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
        ...(cents === undefined ? {} : { amount: { currency_code: 'USD', value: usd(cents) } }),
        note_to_payer: note.slice(0, 255),
      }, `refund-${captureId}`);
    },
    /** PayPal checks the signature for us; true only on SUCCESS. */
    async verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
      if (!cfg.webhookId) return false;
      const h = (k: string) => headers.get(k) ?? '';
      const r = await call<{ verification_status: string }>('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'),
        webhook_id: cfg.webhookId, webhook_event: JSON.parse(rawBody),
      });
      return r.verification_status === 'SUCCESS';
    },
  };
}

export type PayPalClient = ReturnType<typeof client>;

/** The first completed capture on an order, which is what a refund needs. */
export function firstCapture(o: Order) {
  return o.purchase_units?.flatMap((u) => u.payments?.captures ?? []).find((c) => c.status === 'COMPLETED') ?? null;
}

export const approveUrl = (o: Order) => o.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href ?? null;
