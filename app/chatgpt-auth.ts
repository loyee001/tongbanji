// Compatibility name for the existing business layer; identity is local only.
export { getLocalUser as getChatGPTUser } from '@/server/auth';
export type { LocalUser as ChatGPTUser } from '@/server/auth';
