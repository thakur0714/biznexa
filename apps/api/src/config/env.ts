import { z } from 'zod';

/** Validated environment. The app refuses to start with missing or weak secrets in production. */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_ACCESS_TTL: z.string().default('15m'),
    REFRESH_TTL_DAYS: z.coerce.number().default(30),
    OTP_PEPPER: z.string().min(8),
    GOOGLE_CLIENT_ID: z.string().optional().default(''),
    CERT_QR_SECRET: z.string().min(16),
    /** Signs 5-minute file download links. */
    FILE_LINK_SECRET: z.string().min(16),
    /** Encrypts sensitive fields at rest (AES-256-GCM): staff 2FA secrets now, PAN later. Changing it makes them unreadable. */
    DATA_ENCRYPTION_KEY: z.string().min(16),
    /** Private upload folder (D17): outside any public folder, shared by all API instances, backed up. */
    UPLOAD_DIR: z.string().min(1).default('uploads'),
    /** Hard cap per file whatever a document requirement says. */
    UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(100).default(25),
    /** Upload virus scanning (D23). `stub` only flags the EICAR test file and is refused in production. */
    VIRUS_SCANNER: z.enum(['stub', 'clamav']).default('stub'),
    CLAMAV_HOST: z.string().min(1).default('localhost'),
    CLAMAV_PORT: z.coerce.number().int().default(3310),
    SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),
    MSG91_AUTH_KEY: z.string().optional().default(''),
    MSG91_OTP_TEMPLATE_ID: z.string().optional().default(''),
    EMAIL_PROVIDER: z.enum(['console', 'ses', 'sendgrid', 'smtp']).default('smtp'),
    EMAIL_FROM: z.string().default('BizNexa <no-reply@biznexa.com>'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASS: z.string().optional().default(''),
    SMTP_SECURE: z.coerce.boolean().default(false),
    SENDGRID_API_KEY: z.string().optional().default(''),
    AWS_REGION: z.string().optional().default('ap-south-1'),
    AWS_ACCESS_KEY_ID: z.string().optional().default(''),
    AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
    FCM_PROVIDER: z.enum(['fake', 'firebase']).default('fake'),
    FIREBASE_PROJECT_ID: z.string().optional().default(''),
    FIREBASE_SERVICE_ACCOUNT_KEY: z.string().optional().default(''),
    /** Online payments (D42). `mock` is in-memory (dev/test) and refused in production. */
    PAYMENT_GATEWAY: z.enum(['mock', 'razorpay']).default('mock'),
    RAZORPAY_KEY_ID: z.string().optional().default(''),
    RAZORPAY_KEY_SECRET: z.string().optional().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
    COMPANY_STATE_CODE: z.string().length(2).default('PB'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    /** HTML → PDF (M3.22): headless Chromium through Playwright, or a plain-text stub where Chromium isn't installed. */
    PDF_RENDERER: z.enum(['playwright', 'stub']).default('playwright'),
    /** Redis key prefix for queues; tests use their own so a running dev API never picks up test jobs. */
    QUEUE_PREFIX: z.string().min(1).default('bn'),
  })
  .superRefine((v, ctx) => {
    if (v.PAYMENT_GATEWAY === 'razorpay') {
      for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const) {
        if (!v[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'Required when PAYMENT_GATEWAY=razorpay' });
      }
    }
    if (v.NODE_ENV === 'production') {
      for (const k of ['JWT_ACCESS_SECRET', 'OTP_PEPPER', 'CERT_QR_SECRET', 'FILE_LINK_SECRET', 'DATA_ENCRYPTION_KEY'] as const) {
        if (v[k].startsWith('change-me') || v[k].length < 32)
          ctx.addIssue({ code: 'custom', path: [k], message: 'Use a strong random secret (32+ chars) in production' });
      }
      if (v.SMS_PROVIDER === 'console')
        ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'Console SMS provider is not allowed in production' });
      if (v.EMAIL_PROVIDER === 'console' || v.EMAIL_PROVIDER === 'smtp')
        ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'EMAIL_PROVIDER must be ses or sendgrid in production' });
      if (v.EMAIL_PROVIDER === 'sendgrid' && !v.SENDGRID_API_KEY)
        ctx.addIssue({ code: 'custom', path: ['SENDGRID_API_KEY'], message: 'Required when EMAIL_PROVIDER=sendgrid' });
      if (v.FCM_PROVIDER === 'fake')
        ctx.addIssue({ code: 'custom', path: ['FCM_PROVIDER'], message: 'Fake FCM provider is not allowed in production' });
      if (v.FCM_PROVIDER === 'firebase' && !v.FIREBASE_PROJECT_ID)
        ctx.addIssue({ code: 'custom', path: ['FIREBASE_PROJECT_ID'], message: 'Required when FCM_PROVIDER=firebase' });
      if (v.VIRUS_SCANNER === 'stub')
        ctx.addIssue({ code: 'custom', path: ['VIRUS_SCANNER'], message: 'Stub virus scanner is not allowed in production' });
      if (v.PDF_RENDERER === 'stub')
        ctx.addIssue({ code: 'custom', path: ['PDF_RENDERER'], message: 'Stub PDF renderer is not allowed in production' });
      if (v.PAYMENT_GATEWAY === 'mock')
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_GATEWAY'], message: 'Mock payment gateway is not allowed in production' });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid environment configuration:\n${msg}`);
    }
    cached = parsed.data;
  }
  return cached;
}
