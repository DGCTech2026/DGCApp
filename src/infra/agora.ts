import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { env } from '../config/env';

export function isAgoraConfigured(): boolean {
  return !!(env.AGORA_APP_ID && env.AGORA_APP_CERTIFICATE);
}

export function buildRtcToken(channelName: string, uid: number, role: 'host' | 'audience'): string {
  if (!env.AGORA_APP_ID || !env.AGORA_APP_CERTIFICATE) {
    throw new Error('Agora credentials not configured');
  }
  const agoraRole = role === 'host' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
  const expireSeconds = 3600;
  return RtcTokenBuilder.buildTokenWithUid(
    env.AGORA_APP_ID,
    env.AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    agoraRole,
    expireSeconds,
    expireSeconds,
  );
}
