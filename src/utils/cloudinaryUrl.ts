// Cloudinary delivery-URL helpers. These are pure string transforms — the original asset in
// Cloudinary is never touched, we just ask its CDN for a right-sized, auto-format rendition.
// f_auto = WebP/AVIF when the device supports it, q_auto = perceptual quality tuning; together
// they typically cut image bytes 5-15× — the single biggest lever for chat on a slow network.

const UPLOAD_RE = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/(image|video)\/upload\/)(.+)$/;

// Insert a transformation segment after /upload/. Non-Cloudinary URLs (e.g. Google avatars)
// pass through untouched. Idempotent: skips if this exact transform is already the first segment.
export function withTransform(url: string, transform: string): string {
  const m = UPLOAD_RE.exec(url);
  if (!m) return url;
  if (m[3]!.startsWith(`${transform}/`)) return url;
  return `${m[1]}${transform}/${m[3]}`;
}

// Full-view chat image: capped at 1600px (plenty for any phone screen), auto format/quality.
export function optimizeImage(url: string): string {
  return withTransform(url, 'f_auto,q_auto,c_limit,w_1600');
}

// Avatars render at ≤128px in lists; 512 covers profile view on retina screens.
export function optimizeAvatar(url: string): string {
  return withTransform(url, 'f_auto,q_auto,c_limit,w_512');
}

// Small preview for message lists: ~10-30KB instead of megabytes. For videos, a poster frame
// (first frame as jpg) so the list renders without downloading any video bytes.
export function thumbUrl(url: string | null, type: string): string | null {
  if (!url) return null;
  if (type === 'IMAGE') {
    // Swap (don't stack on) the stored full-view transform, so the thumb is a single transformation.
    const base = url.replace('/upload/f_auto,q_auto,c_limit,w_1600/', '/upload/');
    return withTransform(base, 'f_auto,q_auto:low,c_limit,w_400');
  }
  if (type === 'VIDEO') {
    const m = UPLOAD_RE.exec(url);
    if (!m || m[2] !== 'video') return null;
    return `${m[1]}so_0,f_jpg,q_auto,c_limit,w_400/${m[3]!.replace(/\.[A-Za-z0-9]+$/, '.jpg')}`;
  }
  return null;
}
