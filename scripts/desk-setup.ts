/**
 * One-time PayPal setup for Sonar Desk: the Sonar Pro product and monthly plan, and (with a public URL) the webhook.
 *   npx tsx scripts/desk-setup.ts                       -> prints PAYPAL_PLAN_ID
 *   npx tsx scripts/desk-setup.ts https://desk.example  -> also registers <url>/api/pay/webhook, prints PAYPAL_WEBHOOK_ID
 * Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_ENV from the environment. Safe to re-run: product and plan
 * creation are idempotent by request id.
 */
import { client, paypalConfig } from '../src/lib/paypal';
import { PRO_PRICE_CENTS, WEBHOOK_EVENTS } from '../src/lib/desk';

(async () => {
  const cfg = paypalConfig();
  if (!cfg) throw new Error('set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
  const pp = client(cfg);
  const product = await pp.createProduct('Sonar Pro', 'Unlimited Sonar Desk signal briefs');
  const plan = await pp.createPlan(product.id, 'Sonar Pro monthly', PRO_PRICE_CENTS);
  console.log(`PAYPAL_PLAN_ID=${plan.id}   # product ${product.id}, ${cfg.env}`);
  const url = process.argv[2];
  if (url) {
    const hook = await pp.createWebhook(`${url.replace(/\/$/, '')}/api/pay/webhook`, WEBHOOK_EVENTS);
    console.log(`PAYPAL_WEBHOOK_ID=${hook.id}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
