import { initializeApp, cert, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { env } from '../config/env';
import { logger } from './logger';

// Push is optional infra (like SMS): initialised only when FCM_SERVICE_ACCOUNT is set. Until then
// every send is a no-op, so nothing breaks before Firebase is configured.
let app: App | null = null;
if (env.FCM_SERVICE_ACCOUNT) {
  try {
    const svc = JSON.parse(Buffer.from(env.FCM_SERVICE_ACCOUNT, 'base64').toString('utf8'));
    app = initializeApp({ credential: cert(svc) });
    logger.info('FCM push initialised');
  } catch (err) {
    logger.error({ err }, 'FCM init failed — push disabled');
  }
}

export const isPushConfigured = () => app !== null;

export function fcm(): Messaging {
  if (!app) throw new Error('FCM not configured');
  return getMessaging(app);
}
