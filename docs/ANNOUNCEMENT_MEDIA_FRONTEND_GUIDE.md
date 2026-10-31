# Announcement Media Frontend Guide

How to post announcements with photos, videos, audio and documents, and how to fix the
`Cannot read property 'Base64' of undefined` crash.

## 1. Fix the crash first (frontend bug)

`Could not save edits — Cannot read property 'Base64' of undefined` is thrown **inside the app**, before
any request is sent. It comes from code like:

```ts
import * as FileSystem from 'expo-file-system';
FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }); // EncodingType is undefined on SDK 54+
```

Since Expo SDK 54 the default `expo-file-system` import no longer has `EncodingType`.

**Fix:** delete the base64 step. The backend never accepts file bytes or base64. Upload the file
straight to Cloudinary as shown in step 3. As a stop-gap only, `import * as FileSystem from 'expo-file-system/legacy'`
makes the old code run again.

## 2. What the backend now supports

- Announcements can have **1–10 attachments** (photos, videos, audio, documents) in display order.
- Each attachment is checked when the announcement is posted: it must come from the DGC Cloudinary
  account, have an allowed file type, and be under the size limit. Failures return a specific error
  code (section 6).
- Each attachment gets a correct `type`: `IMAGE`, `VIDEO`, `AUDIO` or `FILE`. Audio and PDFs are
  labelled correctly now (before, audio showed as video and PDFs as images).
- `body` (the text) is optional when there is media. `title` is still required.

Nothing that works today breaks. The old single-file `mediaUrl` field still works, and every
announcement still returns `mediaUrl` and `type` (taken from the first attachment).

## 3. Posting flow

```
GET  /api/v1/media/limits            → allowed types + max sizes (cache it)
check each picked file locally       → show an error before uploading
POST /api/v1/media/signature {type:"media"} → signed params (cache until expiresAt)
POST <uploadUrl> (Cloudinary)        → secure_url, bytes, width, height  (one per file)
POST /api/v1/announcements           → { title, body?, attachments: [...] }
```

Branch announcements use `POST /api/v1/branches/{branchId}/announcements` with the same body.

### 3a. Limits

`GET /api/v1/media/limits` (also included as `limits` in the `/media/signature` response):

```json
{
  "kinds": {
    "IMAGE": { "maxBytes": 10485760,  "formats": ["jpg","jpeg","png","gif","webp","heic","heif"] },
    "VIDEO": { "maxBytes": 104857600, "formats": ["mp4","mov","m4v","webm","3gp"] },
    "AUDIO": { "maxBytes": 104857600, "formats": ["mp3","m4a","aac","wav","ogg","oga","opus","amr"] },
    "FILE":  { "maxBytes": 10485760,  "formats": ["pdf","doc","docx","xls","xlsx","ppt","pptx","txt"] }
  },
  "maxAttachments": 10
}
```

Read these values from the endpoint rather than hard-coding them. The backend can change them.

### 3b. Check before upload

```ts
type Limits = { kinds: Record<'IMAGE'|'VIDEO'|'AUDIO'|'FILE', { maxBytes: number; formats: string[] }>; maxAttachments: number };

function checkFile(limits: Limits, name: string, size?: number): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const entry = Object.entries(limits.kinds).find(([, k]) => k.formats.includes(ext));
  if (!entry) return `.${ext} files can't be shared`;
  const [, { maxBytes }] = entry;
  if (size && size > maxBytes) return `File is too large (max ${Math.round(maxBytes / 1048576)} MB)`;
  return null; // ok
}
```

Use `asset.fileName` / `asset.fileSize` from `expo-image-picker`, or `asset.name` / `asset.size` from
`expo-document-picker`. If there's no file name, use the extension from the `uri`.

### 3c. Upload one file to Cloudinary (no base64)

```ts
async function uploadToCloudinary(sig: Signature, file: { uri: string; name: string; mimeType: string }) {
  const form = new FormData();
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('folder', sig.folder);
  form.append('signature', sig.signature);
  const res = await fetch(sig.uploadUrl, { method: 'POST', body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? 'Upload failed');
  return { url: json.secure_url, bytes: json.bytes, width: json.width, height: json.height };
}
```

Send exactly these five fields. Adding upload options such as `tags`, `transformation` or `public_id`
breaks the signature, and Cloudinary rejects the upload. Cache the signature response per type and reuse it until `expiresAt`.

### 3d. Post the announcement

```http
POST /api/v1/announcements
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "Sunday service highlights",
  "body": "Thank you all for coming!",
  "attachments": [
    { "url": "https://res.cloudinary.com/<cloud>/image/upload/v1/dgc/media/a.jpg", "bytes": 2348123, "width": 1080, "height": 1350 },
    { "url": "https://res.cloudinary.com/<cloud>/video/upload/v1/dgc/media/b.mp4", "bytes": 48211001, "width": 1920, "height": 1080 }
  ]
}
```

- Send `url` exactly as Cloudinary returned it (`secure_url`). Don't rebuild it or swap in another host.
- Always send `bytes` so the backend can check the size. `width`/`height` are optional, but they let the
  feed reserve space before images load.
- Single-file form (still supported): `{ "title": "...", "mediaUrl": "<secure_url>" }`. Don't send
  both `mediaUrl` and `attachments`.

## 4. Response / feed shape

`POST` returns the announcement (201). `GET /api/v1/announcements` and
`GET /api/v1/branches/{branchId}/announcements` return a list with the same shape. The live
`message:new` socket event uses it too.

```json
{
  "id": "…",
  "title": "Sunday service highlights",
  "body": "Thank you all for coming!",
  "type": "IMAGE",
  "mediaUrl": "https://res.cloudinary.com/…/a.jpg",
  "attachments": [
    { "id": "…", "url": "…/a.jpg", "type": "IMAGE", "position": 0, "width": 1080, "height": 1350 },
    { "id": "…", "url": "…/b.mp4", "type": "VIDEO", "position": 1, "width": 1920, "height": 1080 }
  ],
  "createdAt": "2026-10-31T09:00:00.000Z",
  "sender": { "id": "…", "displayName": "…", "avatarUrl": "…" },
  "reactions": []
}
```

- Text-only announcements have `"type": "TEXT"`, `"mediaUrl": null` and `"attachments": []`.
- `type`/`mediaUrl` are the first attachment's, kept for older app versions. New code should render `attachments`.

## 5. Rendering by `type`

| `type`  | Show as |
|---------|---------|
| `IMAGE` | Image; for 2+ use a grid/carousel ordered by `position` |
| `VIDEO` | Video player with a thumbnail |
| `AUDIO` | Audio player (not a video player) |
| `FILE`  | File card (name from the URL, icon by extension); open in a browser/viewer |

Push notifications for announcements with no text say "Shared a photo", "Shared a video", "Shared
audio", "Shared a file" or "Shared N attachments".

## 6. Errors

All errors use the standard envelope `{ "error": { "code": "...", "message": "..." } }`. The `message`
is already readable, so you can show it as-is, or map the `code` to your own wording.

| HTTP | `code` | Meaning | Suggested message to the user |
|------|--------|---------|-------------------------------|
| 413 | `MEDIA_TOO_LARGE` | `bytes` is over the limit for that type | "This file is too large. Photos and documents up to 10 MB, videos and audio up to 100 MB." |
| 415 | `MEDIA_TYPE_NOT_SUPPORTED` | Extension not in `/media/limits` | "This file type can't be shared." |
| 400 | `MEDIA_URL_NOT_ALLOWED` | URL isn't a file in the DGC Cloudinary account | "Upload failed, please try again." (this is an app bug, so log it) |
| 400 | `BAD_REQUEST` | Body invalid: no title, no text and no media, more than 10 attachments, both `mediaUrl` and `attachments` | Show `message` |
| 403 | `FORBIDDEN` | User can't post announcements | "You don't have permission to post announcements." |
| 503 | `MEDIA_NOT_CONFIGURED` | Server media config missing | "Media uploads are unavailable right now." |

If Cloudinary rejects an upload (step 3c) because it exceeds the plan cap, its error comes back from
Cloudinary, not our API. Checking against `/media/limits` first avoids that.

## 7. Checklist

- [ ] Remove `FileSystem.EncodingType.Base64` / base64 conversion from the announcement image flow
- [ ] Fetch and cache `GET /media/limits`; validate type/size and the 10-file maximum before uploading
- [ ] Upload each file with `FormData` (`uri`, `name`, `type`) to `uploadUrl`
- [ ] Post `attachments: [{ url, bytes, width, height }]`
- [ ] Render `attachments` by `type`; fall back to `mediaUrl` only if `attachments` is missing
- [ ] Handle `MEDIA_TOO_LARGE`, `MEDIA_TYPE_NOT_SUPPORTED`, `MEDIA_URL_NOT_ALLOWED`
