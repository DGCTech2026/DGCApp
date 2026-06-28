import { cloudinary } from '../../infra/cloudinary';
import { BadRequest } from '../../utils/errors';
import type { UploadType } from './media.schema';

const FOLDERS = {
  avatar: 'dgc/avatars',
  media: 'dgc/media',
  certificate: 'dgc/certificates',
  chat: 'dgc/chat',
} as const;

export const mediaService = {
  // Signed direct upload (CLAUDE.md §3): we sign {timestamp, folder} with the API secret; the
  // client uploads straight to Cloudinary with these params, then sends us the resulting URL.
  // The API secret never leaves the server; cloud_name + api_key are public.
  createUploadSignature(type: UploadType) {
    const cfg = cloudinary.config();
    if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) {
      throw BadRequest('Media uploads are not configured');
    }
    const timestamp = Math.round(Date.now() / 1000);
    const folder = FOLDERS[type];
    const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, cfg.api_secret);
    return {
      cloudName: cfg.cloud_name,
      apiKey: cfg.api_key,
      timestamp,
      folder,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cfg.cloud_name}/auto/upload`,
    };
  },
};
