import { BrevoClient } from '@getbrevo/brevo';
import { env } from '../config/env';
import { otpEmail, resetOtpEmail } from './emailTemplate';

const client = new BrevoClient({ apiKey: env.BREVO_API_KEY });

async function sendEmail(to: string, email: { subject: string; html: string; text: string }) {
  await client.transactionalEmails.sendTransacEmail({
    sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
    to: [{ email: to }],
    subject: email.subject,
    htmlContent: email.html,
    textContent: email.text,
  });
}

export async function sendOtpEmail(to: string, code: string) {
  await sendEmail(to, otpEmail(code));
}

export async function sendResetOtpEmail(to: string, code: string) {
  await sendEmail(to, resetOtpEmail(code));
}
