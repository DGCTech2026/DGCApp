import { v2 as cloudinary } from 'cloudinary';

// Configured automatically from CLOUDINARY_URL env var.
cloudinary.config({ secure: true });

export { cloudinary };
