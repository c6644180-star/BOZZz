import { proposeIntent } from './intent';

export async function proposeFromText(text: string, source: 'voice' | 'chat' | 'gesture') {
  // Send to backend which uses the same deterministic parser
  // or (later) an LLM constrained to the action schema
  return proposeIntent({
    text,
    source,
    requireApproval: true,
  });
}