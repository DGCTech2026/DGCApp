export function looksLikeRawApnsToken(token: string): boolean {
  return /^[a-f0-9]{64}$/i.test(token.trim());
}
