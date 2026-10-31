import { cloudinary } from '../../infra/cloudinary';
import { AppError } from '../../utils/errors';

export type MediaKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE';

const MB = 1024 * 1024;

// One place for what the app accepts as message media. Sizes sit inside the Cloudinary free-plan
// caps (10 MB image/raw, 100 MB video — Cloudinary stores audio as video). Raise them here if the
// plan changes; GET /media/limits hands the same table to the client so it can check before upload.
export const MEDIA_LIMITS: Record<MediaKind, { maxBytes: number; formats: readonly string[] }> = {
  IMAGE: { maxBytes: 10 * MB, formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'] },
  VIDEO: { maxBytes: 100 * MB, formats: ['mp4', 'mov', 'm4v', 'webm', '3gp'] },
  AUDIO: { maxBytes: 100 * MB, formats: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'amr'] },
  FILE: { maxBytes: 10 * MB, formats: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'] },
};

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

const KIND_BY_FORMAT = new Map<string, MediaKind>(
  (Object.keys(MEDIA_LIMITS) as MediaKind[]).flatMap((kind) =>
    MEDIA_LIMITS[kind].formats.map((f) => [f, kind] as const),
  ),
);

const LABEL: Record<MediaKind, string> = { IMAGE: 'Photo', VIDEO: 'Video', AUDIO: 'Audio', FILE: 'File' };

const toMb = (bytes: number) => `${Math.round((bytes / MB) * 10) / 10} MB`;

export function mediaLimits() {
  return { kinds: MEDIA_LIMITS, maxAttachments: MAX_ATTACHMENTS_PER_MESSAGE };
}

// Checks a client-sent media URL before we store it:
//  - it must be a file in OUR Cloudinary account (https://res.cloudinary.com/<cloud_name>/<type>/upload/…),
//    so nobody can attach a link to an arbitrary site or another account's asset;
//  - its extension decides the kind (Cloudinary files audio under /video/ and PDFs under /image/, so
//    the path alone would mislabel them) and must be on the allow-list;
//  - `bytes` (Cloudinary's upload response field) must be under the kind's limit when sent. It is
//    client-reported, so it gives fast, clear errors; the hard ceiling is still Cloudinary's plan cap.
export function inspectMediaUrl(url: string, bytes?: number): { kind: MediaKind } {
  const cloudName = cloudinary.config().cloud_name;
  if (!cloudName) throw new AppError(503, 'MEDIA_NOT_CONFIGURED', 'Media uploads are not configured');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(400, 'MEDIA_URL_NOT_ALLOWED', 'Media URL is not valid');
  }
  const [cloud, resourceType, deliveryType] = parsed.pathname.split('/').filter(Boolean);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'res.cloudinary.com' ||
    cloud !== cloudName ||
    !['image', 'video', 'raw'].includes(resourceType ?? '') ||
    deliveryType !== 'upload'
  ) {
    throw new AppError(
      400,
      'MEDIA_URL_NOT_ALLOWED',
      'Media must be uploaded through the app (use the secure_url Cloudinary returns after POST /media/signature)',
    );
  }

  const file = parsed.pathname.split('/').pop() ?? '';
  const ext = file.includes('.') ? (file.split('.').pop() ?? '').toLowerCase() : '';
  const kind = KIND_BY_FORMAT.get(ext);
  if (!kind) {
    throw new AppError(
      415,
      'MEDIA_TYPE_NOT_SUPPORTED',
      `${ext ? `.${ext}` : 'This'} file type is not supported. Allowed: ${[...KIND_BY_FORMAT.keys()].join(', ')}`,
    );
  }

  const { maxBytes } = MEDIA_LIMITS[kind];
  if (bytes !== undefined && bytes > maxBytes) {
    throw new AppError(
      413,
      'MEDIA_TOO_LARGE',
      `${LABEL[kind]} is ${toMb(bytes)}; the limit is ${toMb(maxBytes)}`,
    );
  }
  return { kind };
}
