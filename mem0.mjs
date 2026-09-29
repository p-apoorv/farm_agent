import { createHmac } from 'node:crypto';

const mem0BaseUrl = () => (process.env.MEM0_BASE_URL || 'https://api.mem0.ai').replace(/\/$/, '');

export function isMem0Configured() {
  return Boolean(process.env.MEM0_API_KEY);
}

export function normalizePhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function mem0UserIdForPhone(value) {
  const phone = normalizePhoneNumber(value);
  if (!phone) return null;
  const secret = process.env.USER_ID_SECRET || process.env.MEM0_USER_ID_SECRET || process.env.MEM0_API_KEY;
  if (!secret) return null;
  const digest = createHmac('sha256', secret).update(phone).digest('hex').slice(0, 40);
  return `nelam-${digest}`;
}

async function mem0Request(path, body) {
  const response = await fetch(`${mem0BaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${process.env.MEM0_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Mem0 request failed (${response.status})`);
  return response.json();
}

export async function searchUserMemories(userId, query) {
  if (!isMem0Configured() || !query?.trim()) return [];
  const data = await mem0Request('/v3/memories/search/', {
    query: query.trim().slice(0, 1000),
    filters: { user_id: userId },
    top_k: 4
  });
  return (data.results || []).map(item => item.memory).filter(Boolean).slice(0, 4);
}

function clip(text, limit) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export async function storeChatSummary({ userId, message, reply, language, module = 'crop-advisory' }) {
  if (!isMem0Configured()) return false;
  const question = clip(message, 300);
  const answer = clip(reply, 500);
  if (!question || !answer) return false;
  const summary = `Farm assistant chat (${language || 'unknown'}, ${module}): Farmer asked: ${question} Assistant replied: ${answer}`;
  await mem0Request('/v3/memories/add/', {
    messages: [{ role: 'user', content: summary }],
    user_id: userId,
    infer: false,
    metadata: { kind: 'chat_summary', module, language: language || 'unknown', app: 'nelam' }
  });
  return true;
}
