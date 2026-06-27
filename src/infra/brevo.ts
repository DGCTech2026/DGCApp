import { BrevoClient } from '@getbrevo/brevo';
import { env } from '../config/env';

const client = new BrevoClient({ apiKey: env.BREVO_API_KEY });

export async function sendOtpEmail(to: string, code: string) {
  await client.transactionalEmails.sendTransacEmail({
    sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
    to: [{ email: to }],
    subject: 'Your DGC verification code',
    htmlContent: `<p>Your code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
  });
}
