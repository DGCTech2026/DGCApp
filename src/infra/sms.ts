import { env } from '../config/env';
import { logger } from './logger';

// Phone OTP delivery. Gated on TERMII_API_KEY — exactly like Google is gated on its client ID:
// the code is present and wired, but phone sign-in stays disabled until a provider key is set.
// Termii (https://termii.com) is the default (strong SMS deliverability in Nigeria). Swap the
// body/endpoint here for Twilio etc. without touching the auth flow.

export function isSmsConfigured(): boolean {
  return !!env.TERMII_API_KEY;
}

export async function sendOtpSms(to: string, code: string): Promise<void> {
  if (!env.TERMII_API_KEY) {
    throw new Error('SMS provider not configured (TERMII_API_KEY missing)');
  }
  const res = await fetch(`${env.TERMII_BASE_URL}/api/sms/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      from: env.TERMII_SENDER_ID,
      sms: `Your DGC verification code is ${code}. It expires in 10 minutes.`,
      type: 'plain',
      channel: 'generic',
      api_key: env.TERMII_API_KEY,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Termii SMS send failed: ${res.status} ${body}`);
  }
  logger.info({ to }, 'OTP SMS sent');
}
