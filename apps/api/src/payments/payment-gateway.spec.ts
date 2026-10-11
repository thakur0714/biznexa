import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MockPaymentGateway } from './mock-payment-gateway';
import { PaymentGatewayError, signatureMatches } from './payment-gateway';
import { RazorpayGateway } from './razorpay-gateway';

const sign = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

describe('signatureMatches', () => {
  it('accepts only the exact hex signature, whatever the case', () => {
    const good = sign('s', 'body');
    expect(signatureMatches(good, good)).toBe(true);
    expect(signatureMatches(good, good.toUpperCase())).toBe(true);
    expect(signatureMatches(good, good.slice(0, -2))).toBe(false);
    expect(signatureMatches(good, `${good}00`)).toBe(false);
    expect(signatureMatches(good, sign('s', 'other'))).toBe(false);
    expect(signatureMatches(good, 'not-hex')).toBe(false);
    expect(signatureMatches(good, '')).toBe(false);
    expect(signatureMatches(good, undefined)).toBe(false);
  });
});

type Handler = (req: { method: string; url: string; auth?: string; body: unknown }) => { status: number; body?: unknown; raw?: string; delayMs?: number };

/** A fake Razorpay API answering with `handler`; records every request. */
async function fakeRazorpay(handler: Handler) {
  const requests: Parameters<Handler>[0][] = [];
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const r = { method: req.method!, url: req.url!, auth: req.headers.authorization, body: text ? JSON.parse(text) : undefined };
    requests.push(r);
    const answer = handler(r);
    if (answer.delayMs) await new Promise((done) => setTimeout(done, answer.delayMs));
    if (res.destroyed) return;
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(answer.raw ?? JSON.stringify(answer.body ?? {}));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { requests, baseUrl, close: () => new Promise<void>((done) => server.close(() => done())) };
}

const config = { keyId: 'rzp_test_abc', keySecret: 'key-secret', webhookSecret: 'hook-secret' };

describe('RazorpayGateway', () => {
  let fake: Awaited<ReturnType<typeof fakeRazorpay>> | undefined;
  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });
  const gateway = async (handler: Handler, timeoutMs?: number) => {
    fake = await fakeRazorpay(handler);
    return new RazorpayGateway({ ...config, baseUrl: fake.baseUrl, timeoutMs });
  };

  it('exposes the key id for checkout, never the secret', () => {
    const g = new RazorpayGateway(config);
    expect(g.name).toBe('RAZORPAY');
    expect(g.checkoutKey).toBe('rzp_test_abc');
  });

  it('creates an order in paise with Basic auth', async () => {
    const g = await gateway(() => ({
      status: 200,
      body: { id: 'order_123', entity: 'order', amount: 118000, amount_paid: 0, currency: 'INR', receipt: 'pay-1', status: 'created', attempts: 0 },
    }));
    const order = await g.createOrder({ amount: 118000, receipt: 'pay-1', notes: { orderCode: 'ORD-2026-000001' } });
    expect(order).toEqual({ id: 'order_123', amount: 118000, currency: 'INR', receipt: 'pay-1', status: 'created' });
    expect(fake!.requests).toEqual([
      {
        method: 'POST',
        url: '/v1/orders',
        auth: `Basic ${Buffer.from('rzp_test_abc:key-secret').toString('base64')}`,
        body: { amount: 118000, currency: 'INR', receipt: 'pay-1', notes: { orderCode: 'ORD-2026-000001' } },
      },
    ]);
  });

  it('refuses bad order input before calling Razorpay', async () => {
    const g = await gateway(() => ({ status: 200 }));
    for (const input of [
      { amount: 99, receipt: 'r' },
      { amount: 1000.5, receipt: 'r' },
      { amount: 1000, receipt: '' },
      { amount: 1000, receipt: 'x'.repeat(41) },
      { amount: 1000, receipt: 'r', notes: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, 'v'])) },
    ]) {
      await expect(g.createOrder(input)).rejects.toMatchObject({ name: 'PaymentGatewayError', retryable: false });
    }
    expect(fake!.requests).toHaveLength(0);
  });

  it('verifies the checkout signature over order_id|payment_id with the key secret', () => {
    const g = new RazorpayGateway(config);
    const signature = sign('key-secret', 'order_123|pay_456');
    expect(g.verifyPaymentSignature({ orderId: 'order_123', paymentId: 'pay_456', signature })).toBe(true);
    // Another order, another payment, the webhook secret, or a missing id all fail.
    expect(g.verifyPaymentSignature({ orderId: 'order_999', paymentId: 'pay_456', signature })).toBe(false);
    expect(g.verifyPaymentSignature({ orderId: 'order_123', paymentId: 'pay_999', signature })).toBe(false);
    expect(g.verifyPaymentSignature({ orderId: 'order_123', paymentId: 'pay_456', signature: sign('hook-secret', 'order_123|pay_456') })).toBe(false);
    expect(g.verifyPaymentSignature({ orderId: '', paymentId: 'pay_456', signature: sign('key-secret', '|pay_456') })).toBe(false);
  });

  it('verifies webhook signatures over the raw body with the webhook secret', () => {
    const g = new RazorpayGateway(config);
    const raw = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1","amount":118000}}}}';
    const signature = sign('hook-secret', raw);
    expect(g.verifyWebhookSignature(raw, signature)).toBe(true);
    expect(g.verifyWebhookSignature(Buffer.from(raw), signature)).toBe(true);
    // Re-serialised JSON (different spacing) or a changed amount no longer matches.
    expect(g.verifyWebhookSignature(JSON.stringify(JSON.parse(raw), null, 1), signature)).toBe(false);
    expect(g.verifyWebhookSignature(raw.replace('118000', '100'), signature)).toBe(false);
    expect(g.verifyWebhookSignature(raw, sign('key-secret', raw))).toBe(false);
    expect(g.verifyWebhookSignature(raw, undefined)).toBe(false);
  });

  it('reads a signed webhook: event id from the header, payment normalised, null when the signature fails', () => {
    const g = new RazorpayGateway(config);
    const raw = JSON.stringify({
      entity: 'event',
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 118000, currency: 'INR', status: 'failed', method: 'card', error_description: 'Card declined', created_at: 1760000000 } } },
    });
    const headers = { 'x-razorpay-signature': sign('hook-secret', raw), 'x-razorpay-event-id': 'evt_1' };

    const event = g.readWebhook(Buffer.from(raw), headers);
    expect(event).toMatchObject({ id: 'evt_1', type: 'payment.failed', body: JSON.parse(raw) });
    expect(event?.payment).toMatchObject({ id: 'pay_1', orderId: 'order_1', amount: 118000, currency: 'INR', status: 'failed', method: 'card', failureReason: 'Card declined' });

    expect(g.readWebhook(Buffer.from(raw), { 'x-razorpay-event-id': 'evt_1' })).toBeNull();
    expect(g.readWebhook(Buffer.from(raw.replace('118000', '100')), headers)).toBeNull();
    // Without the event-id header the event name + payment id identify it, so a redelivery still matches.
    expect(g.readWebhook(Buffer.from(raw), { 'x-razorpay-signature': headers['x-razorpay-signature'] })?.id).toBe('payment.failed:pay_1');
  });

  it('reads events without a payment, and refuses a signed body it cannot read', () => {
    const g = new RazorpayGateway(config);
    const other = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1' } } } });
    expect(g.readWebhook(Buffer.from(other), { 'x-razorpay-signature': sign('hook-secret', other), 'x-razorpay-event-id': 'evt_2' })).toMatchObject({
      id: 'evt_2',
      type: 'refund.processed',
      payment: null,
    });
    for (const bad of ['not json', '{"payload":{}}']) {
      expect(() => g.readWebhook(Buffer.from(bad), { 'x-razorpay-signature': sign('hook-secret', bad) })).toThrow(PaymentGatewayError);
    }
  });

  it('fetches a payment and normalises it', async () => {
    const g = await gateway(() => ({
      status: 200,
      body: { id: 'pay_456', entity: 'payment', order_id: 'order_123', amount: 118000, amount_refunded: 0, currency: 'INR', status: 'captured', method: 'upi', error_description: null, created_at: 1_791_000_000 },
    }));
    expect(await g.fetchPayment('pay_456')).toEqual({
      id: 'pay_456', orderId: 'order_123', amount: 118000, amountRefunded: 0, currency: 'INR', status: 'captured', method: 'upi', failureReason: null, createdAt: new Date(1_791_000_000_000),
    });
    expect(fake!.requests[0]).toMatchObject({ method: 'GET', url: '/v1/payments/pay_456', body: undefined });
  });

  it('gives the failure reason of a failed payment', async () => {
    const g = await gateway(() => ({
      status: 200,
      body: { id: 'pay_9', order_id: 'order_1', amount: 500, amount_refunded: 0, currency: 'INR', status: 'failed', method: 'card', error_description: 'Your card was declined.', created_at: 1 },
    }));
    expect(await g.fetchPayment('pay_9')).toMatchObject({ status: 'failed', failureReason: 'Your card was declined.' });
  });

  it('never puts an unsafe id into the URL', async () => {
    const g = await gateway(() => ({ status: 200 }));
    await expect(g.fetchPayment('../orders')).rejects.toMatchObject({ retryable: false });
    await expect(g.refund({ paymentId: 'pay_1/../x' })).rejects.toMatchObject({ retryable: false });
    expect(fake!.requests).toHaveLength(0);
  });

  it('refunds a payment fully or partly with our receipt', async () => {
    const g = await gateway((req) => ({
      status: 200,
      body: { id: 'rfnd_1', entity: 'refund', payment_id: 'pay_456', amount: (req.body as { amount?: number }).amount ?? 118000, status: 'processed' },
    }));
    expect(await g.refund({ paymentId: 'pay_456', amount: 50000, receipt: 'refund-1', notes: { reason: 'Service cancelled' } })).toEqual({
      id: 'rfnd_1', paymentId: 'pay_456', amount: 50000, status: 'processed',
    });
    expect(await g.refund({ paymentId: 'pay_456' })).toMatchObject({ amount: 118000 });
    expect(fake!.requests.map((r) => [r.url, r.body])).toEqual([
      ['/v1/payments/pay_456/refund', { amount: 50000, receipt: 'refund-1', notes: { reason: 'Service cancelled' } }],
      ['/v1/payments/pay_456/refund', { notes: {} }],
    ]);
    await expect(g.refund({ paymentId: 'pay_456', amount: 0 })).rejects.toMatchObject({ retryable: false });
  });

  it('turns a Razorpay refusal into a non-retryable error with its code and description', async () => {
    const g = await gateway(() => ({ status: 400, body: { error: { code: 'BAD_REQUEST_ERROR', description: 'The refund amount provided is greater than amount captured' } } }));
    const err = await g.refund({ paymentId: 'pay_456', amount: 999_999 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect(err).toMatchObject({ retryable: false, status: 400, code: 'BAD_REQUEST_ERROR' });
    expect((err as Error).message).toContain('greater than amount captured');
    expect((err as Error).message).not.toContain('key-secret');
  });

  it('marks 5xx, 429, unreadable answers, network errors and timeouts as retryable', async () => {
    for (const answer of [{ status: 502 }, { status: 429, body: { error: { code: 'BAD_REQUEST_ERROR', description: 'Too many requests' } } }, { status: 200, raw: '<html>' }]) {
      const g = await gateway(() => answer);
      await expect(g.fetchPayment('pay_1')).rejects.toMatchObject({ retryable: true });
      await fake!.close();
      fake = undefined;
    }

    const down = new RazorpayGateway({ ...config, baseUrl: 'http://127.0.0.1:1' });
    await expect(down.fetchPayment('pay_1')).rejects.toMatchObject({ retryable: true, message: 'Could not reach Razorpay' });

    const slow = await gateway(() => ({ status: 200, delayMs: 500 }), 50);
    await expect(slow.fetchPayment('pay_1')).rejects.toMatchObject({ retryable: true, message: expect.stringContaining('did not answer') });
  });
});

describe('MockPaymentGateway', () => {
  it('runs a successful checkout whose signatures pass verification', async () => {
    const g = new MockPaymentGateway();
    const order = await g.createOrder({ amount: 118000, receipt: 'pay-1' });
    expect(order).toMatchObject({ amount: 118000, currency: 'INR', status: 'created' });

    const result = g.pay(order.id);
    expect(g.verifyPaymentSignature(result)).toBe(true);
    expect(g.verifyPaymentSignature({ ...result, orderId: 'order_other' })).toBe(false);
    expect(await g.fetchPayment(result.paymentId)).toMatchObject({ orderId: order.id, amount: 118000, status: 'captured', method: 'upi' });

    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: result.paymentId } } } });
    expect(g.verifyWebhookSignature(body, g.signWebhook(body))).toBe(true);
    expect(g.verifyWebhookSignature(body, g.signWebhook(`${body} `))).toBe(false);
  });

  it('records failed attempts with a reason', async () => {
    const g = new MockPaymentGateway();
    const order = await g.createOrder({ amount: 500, receipt: 'pay-2' });
    const failed = g.fail(order.id, 'UPI request expired', 'upi');
    expect(await g.fetchPayment(failed.id)).toMatchObject({ status: 'failed', failureReason: 'UPI request expired' });
    expect(g.orders.get(order.id)?.status).toBe('attempted');
  });

  it('refunds partly, then the rest, and refuses more than was captured', async () => {
    const g = new MockPaymentGateway();
    const { paymentId } = g.pay((await g.createOrder({ amount: 10000, receipt: 'pay-3' })).id);
    expect(await g.refund({ paymentId, amount: 4000 })).toMatchObject({ amount: 4000, status: 'processed' });
    expect(await g.fetchPayment(paymentId)).toMatchObject({ status: 'captured', amountRefunded: 4000 });
    await expect(g.refund({ paymentId, amount: 6001 })).rejects.toMatchObject({ retryable: false, status: 400 });
    expect(await g.refund({ paymentId })).toMatchObject({ amount: 6000 });
    expect(await g.fetchPayment(paymentId)).toMatchObject({ status: 'refunded', amountRefunded: 10000 });
    await expect(g.refund({ paymentId, amount: 100 })).rejects.toMatchObject({ retryable: false });
  });

  it('applies the same input rules as Razorpay and can simulate an outage', async () => {
    const g = new MockPaymentGateway();
    await expect(g.createOrder({ amount: 50, receipt: 'r' })).rejects.toMatchObject({ retryable: false });
    await expect(g.fetchPayment('pay_missing')).rejects.toMatchObject({ retryable: false, status: 400 });

    g.failNextCall = new PaymentGatewayError('Razorpay did not answer within 15 s', true);
    await expect(g.createOrder({ amount: 1000, receipt: 'r' })).rejects.toMatchObject({ retryable: true });
    await expect(g.createOrder({ amount: 1000, receipt: 'r' })).resolves.toMatchObject({ amount: 1000 });

    g.reset();
    expect(g.orders.size + g.payments.size + g.refunds.size).toBe(0);
  });
});
