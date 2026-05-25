import type { OpenAIRequest } from '../types/openai.js';

export interface CompeatScoreBreakdown {
  score: number;
  length: number;
  lexicalDiversity: number;
  structure: number;
  concreteness: number;
  promptAlignment: number;
  formatAlignment: number;
  completeness: number;
  safety: number;
  latency: number;
}

const stopwords = new Set([
  'a', 'o', 'e', 'de', 'do', 'da', 'dos', 'das', 'em', 'um', 'uma', 'para', 'por', 'com', 'que', 'se', 'no', 'na', 'nos', 'nas',
  'the', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'that', 'this', 'is', 'are', 'be', 'as', 'on', 'it'
]);

function words(value: string): string[] {
  return (value.toLowerCase().match(/\p{L}[\p{L}\p{N}_-]*/gu) ?? []).filter((word) => !stopwords.has(word));
}

function requestText(body: OpenAIRequest): string {
  return body.messages
    .map((message) => {
      if (typeof message.content === 'string') return message.content;
      if (Array.isArray(message.content)) {
        return message.content.map((part) => 'text' in part && typeof part.text === 'string' ? part.text : '').join(' ');
      }
      return '';
    })
    .join(' ');
}

function finishReason(payload: any): string | null {
  const value = payload?.choices?.[0]?.finish_reason;
  return typeof value === 'string' ? value : null;
}

function ratio(value: number, max: number): number {
  return Math.max(0, Math.min(1, value / max));
}

function overlapScore(prompt: string, content: string): number {
  const promptTerms = new Set(words(prompt).filter((word) => word.length > 3));
  if (promptTerms.size === 0) return 0.45;
  const contentTerms = new Set(words(content));
  let hits = 0;
  for (const term of promptTerms) {
    if (contentTerms.has(term)) hits++;
  }
  return Math.min(1, hits / Math.min(10, promptTerms.size));
}

function requestedBulletCount(prompt: string): number | null {
  const numeric = prompt.match(/\b(\d{1,2})\s+(bullets?|tópicos?|topicos?|itens?|pontos?)\b/i);
  if (numeric) return Number(numeric[1]);
  const wordMap: Record<string, number> = {
    dois: 2,
    tres: 3,
    três: 3,
    quatro: 4,
    cinco: 5,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6
  };
  const word = prompt.match(/\b(dois|tres|três|quatro|cinco|two|three|four|five|six)\s+(bullets?|tópicos?|topicos?|itens?|pontos?)\b/i);
  return word ? wordMap[word[1]?.toLowerCase() ?? ''] ?? null : null;
}

function formatScore(prompt: string, content: string): number {
  const requested = requestedBulletCount(prompt);
  const bulletCount = (content.match(/(^|\n)\s*([-*]|\d+[.)])\s+/g) ?? []).length;
  if (requested !== null) {
    return Math.max(0, 1 - Math.abs(bulletCount - requested) / Math.max(1, requested));
  }
  if (/\b(bullets?|tópicos?|topicos?|lista|itens?)\b/i.test(prompt)) {
    return bulletCount > 0 ? 0.9 : 0.25;
  }
  return 0.65;
}

export function scoreCompeatCandidate(
  body: OpenAIRequest,
  content: string,
  payload: any,
  latencyMs: number | null
): CompeatScoreBreakdown {
  if (content.trim().length === 0) {
    return {
      score: 0,
      length: 0,
      lexicalDiversity: 0,
      structure: 0,
      concreteness: 0,
      promptAlignment: 0,
      formatAlignment: 0,
      completeness: 0,
      safety: 0,
      latency: 0
    };
  }

  const lower = content.toLowerCase();
  const allWords = words(content);
  const uniqueWords = new Set(allWords);
  const sentenceCount = content.split(/[.!?。！？]\s+/).filter((item) => item.trim().length > 0).length;
  const listSignals = /(^|\n)\s*([-*]|\d+[.)])\s+/m.test(content) ? 1 : 0;
  const codeSignals = /```|`[^`]+`|function|const|class|interface|curl|npm|docker/i.test(content) ? 1 : 0;
  const concreteSignals = (lower.match(/\b(porque|portanto|assim|exemplo|passo|risco|limite|recomendo|depende|caso|quando|se|therefore|because|example|step|risk|limit|recommend|depends|when)\b/g) ?? []).length;
  const answerSignals = /^(sim|não|nao|é|isso|um|uma|the|yes|no|it|this)/i.test(content.trim()) ? 1 : 0;
  const refusal = /(não posso|nao posso|can't help|cannot assist|as an ai|como uma ia|não consigo|nao consigo)/i.test(lower) ? 1 : 0;
  const vague = (lower.match(/\b(talvez|maybe|possibly|provavelmente|não tenho certeza|nao tenho certeza|acho que|pode ser)\b/g) ?? []).length;
  const prompt = requestText(body);
  const hallucinationPenalty = /(^|\n)\s*SEARCH\b|\[citation:\d+\]|\bcitation needed\b|\bfonte:\s*undefined\b/i.test(content) ? 0.45 : 0;

  const length = ratio(content.length, 1100);
  const lexicalDiversity = ratio(uniqueWords.size / Math.max(1, allWords.length) * 1.6, 1);
  const structure = Math.min(1, listSignals * 0.45 + codeSignals * 0.25 + ratio(sentenceCount, 6) * 0.3);
  const concreteness = Math.min(1, ratio(concreteSignals, 7) * 0.75 + answerSignals * 0.25);
  const promptAlignment = overlapScore(prompt, content);
  const formatAlignment = formatScore(prompt, content);
  const completeness = finishReason(payload) === 'length' ? 0.35 : 1;
  const safety = Math.max(0, 1 - refusal * 0.9 - Math.min(0.45, vague * 0.12) - hallucinationPenalty);
  const latency = latencyMs === null ? 0.5 : Math.max(0, 1 - Math.min(1, latencyMs / 45000));

  const score = Math.round(
    length * 130 +
    lexicalDiversity * 120 +
    structure * 115 +
    concreteness * 165 +
    promptAlignment * 155 +
    formatAlignment * 95 +
    completeness * 120 +
    safety * 150 +
    latency * 45
  );

  return {
    score,
    length,
    lexicalDiversity,
    structure,
    concreteness,
    promptAlignment,
    formatAlignment,
    completeness,
    safety,
    latency
  };
}
