import disposableDomains = require('disposable-email-domains');

// Known disposable/temporary email providers (mailinator, guerrillamail, etc.) — block at signup.
const blocked = new Set(disposableDomains.map((d) => d.toLowerCase()));

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && blocked.has(domain);
}
