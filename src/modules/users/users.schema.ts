import { z } from 'zod';

const e164 = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164 format, e.g. +2348012345678');

// Profile completion (PRD §1 "Create Account" form). Selecting `branchId` the first time triggers
// onboarding (auto-join branch community + Global Announcement). `email`/`phoneNumber` let a user
// add the contact they did NOT sign up with (e.g. email-OTP user adds their phone). `.strict()`
// blocks privilege fields like globalRole from being self-set.
export const updateMeSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    phoneNumber: e164.optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    dateOfBirth: z.coerce.date().optional(),
    occupation: z.string().max(120).optional(),
    avatarUrl: z.string().url().optional(),
    bio: z.string().max(500).optional(),
    branchId: z.string().min(1).optional(),
  })
  .strict();

export type UpdateMeInput = z.infer<typeof updateMeSchema>;

const nonEmptyString = z.string().trim().min(1);
const devicePlatform = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.enum(['ANDROID', 'IOS', 'WEB']));

function unwrapDevicePayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  for (const key of ['device', 'push', 'payload', 'registration']) {
    const nested = input[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return { ...(nested as Record<string, unknown>), ...input };
    }
  }
  return value;
}

function firstPushToken(input: { token?: string; deviceToken?: string; fcmToken?: string; pushToken?: string; apnsToken?: string }) {
  return input.fcmToken ?? input.pushToken ?? input.deviceToken ?? input.token ?? input.apnsToken;
}

// Device registration for push notifications. Android/Web use FCM. iOS may use either an FCM
// token or a raw APNs token, depending on the frontend push library available for the build.
// voipToken is the separate APNs VoIP token iOS clients register via PushKit.
export const registerDeviceSchema = z.preprocess(
  unwrapDevicePayload,
  z
    .object({
      token: nonEmptyString.optional(),
      deviceToken: nonEmptyString.optional(),
      fcmToken: nonEmptyString.optional(),
      pushToken: nonEmptyString.optional(),
      platform: devicePlatform,
      apnsToken: nonEmptyString.optional(),
      voipToken: nonEmptyString.optional(),
      apnsVoipToken: nonEmptyString.optional(),
    })
    .passthrough()
    .superRefine((input, ctx) => {
      const token = firstPushToken(input);
      if (!token) {
        ctx.addIssue({ code: 'custom', message: 'Device token is required' });
      }
    })
    .transform((input) => ({
      token: firstPushToken(input)!,
      platform: input.platform,
      voipToken: input.voipToken ?? input.apnsVoipToken,
    })),
);

export const removeDeviceSchema = z.preprocess(
  unwrapDevicePayload,
  z
    .object({
      token: nonEmptyString.optional(),
      deviceToken: nonEmptyString.optional(),
      fcmToken: nonEmptyString.optional(),
      pushToken: nonEmptyString.optional(),
      apnsToken: nonEmptyString.optional(),
    })
    .passthrough()
    .superRefine((input, ctx) => {
      if (!firstPushToken(input)) {
        ctx.addIssue({ code: 'custom', message: 'Device token is required' });
      }
    })
    .transform((input) => ({ token: firstPushToken(input)! })),
);
