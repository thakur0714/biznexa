import { Injectable, Logger } from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';
import { env } from '../../config/env';

export interface FcmNotificationPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface FcmSendResult {
  success: boolean;
  messageId?: string;
  unregistered?: boolean;
  error?: string;
}

export abstract class FcmProvider {
  abstract send(payload: FcmNotificationPayload): Promise<FcmSendResult>;
}

@Injectable()
export class FakeFcmProvider extends FcmProvider {
  private readonly logger = new Logger(FakeFcmProvider.name);
  readonly sentMessages: FcmNotificationPayload[] = [];
  readonly unregisteredTokens = new Set<string>();

  markTokenUnregistered(token: string): void {
    this.unregisteredTokens.add(token);
  }

  async send(payload: FcmNotificationPayload): Promise<FcmSendResult> {
    this.sentMessages.push(payload);
    this.logger.log(
      `[FakeFcmProvider] Push to token=${payload.token.slice(0, 8)}... title="${payload.title}" link="${payload.data?.link ?? ''}"`,
    );

    if (
      this.unregisteredTokens.has(payload.token) ||
      payload.token.toLowerCase().includes('unregistered')
    ) {
      return {
        success: false,
        unregistered: true,
        error: 'messaging/registration-token-not-registered',
      };
    }

    return {
      success: true,
      messageId: `fake-fcm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  clear(): void {
    this.sentMessages.length = 0;
    this.unregisteredTokens.clear();
  }
}

export class RealFcmProvider extends FcmProvider {
  private readonly logger = new Logger(RealFcmProvider.name);

  private readonly auth: GoogleAuth;

  /** `serviceAccountKey` is the service account JSON; it is exchanged for short-lived OAuth tokens. */
  constructor(
    private readonly projectId: string,
    serviceAccountKey: string,
  ) {
    super();
    this.auth = new GoogleAuth({
      credentials: JSON.parse(serviceAccountKey) as Record<string, string>,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
  }

  async send(payload: FcmNotificationPayload): Promise<FcmSendResult> {
    try {
      // FCM v1 HTTP API endpoint
      const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`;
      const body = {
        message: {
          token: payload.token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: payload.data,
        },
      };

      const accessToken = await this.auth.getAccessToken();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        // Only FCM's own "token is dead" answers; a bare 404 (e.g. wrong project id) must not wipe every token.
        const isUnregistered =
          text.includes('UNREGISTERED') ||
          text.includes('registration-token-not-registered') ||
          text.includes('invalid-registration-token');

        if (isUnregistered) {
          this.logger.warn(`[RealFcmProvider] Token is unregistered: ${payload.token.slice(0, 8)}...`);
          return {
            success: false,
            unregistered: true,
            error: text,
          };
        }

        return {
          success: false,
          error: `HTTP ${res.status}: ${text}`,
        };
      }

      const json = (await res.json()) as { name?: string };
      return {
        success: true,
        messageId: json.name ?? 'fcm-ok',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[RealFcmProvider] Failed to send push: ${message}`);
      return {
        success: false,
        error: message,
      };
    }
  }
}

export const fcmProviderFactory = {
  provide: FcmProvider,
  useFactory: (): FcmProvider => {
    const config = env();
    if (config.FCM_PROVIDER === 'firebase' && config.FIREBASE_PROJECT_ID && config.FIREBASE_SERVICE_ACCOUNT_KEY) {
      return new RealFcmProvider(config.FIREBASE_PROJECT_ID, config.FIREBASE_SERVICE_ACCOUNT_KEY);
    }
    return new FakeFcmProvider();
  },
};
