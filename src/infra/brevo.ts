import { BrevoClient } from '@getbrevo/brevo';
import { env } from '../config/env';
import { otpEmail } from './emailTemplate';

const client = new BrevoClient({ apiKey: env.BREVO_API_KEY });

export async function sendOtpEmail(to: string, code: string) {
  const { subject, html, text } = otpEmail(code);
  await client.transactionalEmails.sendTransacEmail({
    sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text, // multipart (text + html) improves deliverability / spam score
  });
}
