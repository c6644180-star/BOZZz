import { proposeIntent } from './intent';

export async function proposeFromText(text: string, source: 'voice' | 'chat' | 'gesture') {
  // The backend API accepts the natural-language text and applies its
  // own approval policy. Source is retained here for the voice/chat caller.
  void source
  return proposeIntent(text)
}