import type { HelpTopic } from "./knowledge";

/**
 * Keyword-scoring retrieval for the help agent: no embeddings, just token
 * overlap against each topic's keywords, title and content. Deterministic
 * and fast — the knowledge base is small enough that this outperforms the
 * complexity of a vector store.
 */

const STOP_WORDS = new Set([
  "the", "and", "for", "how", "what", "why", "when", "where", "can", "does",
  "with", "from", "you", "your", "our", "are", "was", "have", "has", "not",
  "get", "set", "use", "using", "want", "need", "there", "this", "that",
  "into", "about", "them", "then", "than", "will", "should", "could", "would",
  "please", "help", "work", "works",
]);

export function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    ),
  ];
}

/** Light stemming so "forecasts" matches "forecast", "importing" → "import". */
function stem(token: string): string {
  return token.replace(/(ing|ies|ed|es|s)$/, "");
}

function matches(token: string, candidate: string): boolean {
  if (token === candidate) return true;
  return stem(token) === stem(candidate) && stem(token).length >= 3;
}

export interface ScoredTopic {
  topic: HelpTopic;
  score: number;
}

export function scoreTopic(queryTokens: string[], topic: HelpTopic): number {
  if (queryTokens.length === 0) return 0;
  let score = 0;

  // Multi-word keyword phrases ("bank statement") match against the raw
  // token list joined back together; single keywords match token-by-token.
  const keywordTokens = topic.keywords.flatMap((keyword) => tokenize(keyword));
  const titleTokens = tokenize(topic.title);
  const contentTokens = tokenize(topic.content);

  for (const token of queryTokens) {
    if (keywordTokens.some((keyword) => matches(token, keyword))) score += 4;
    if (titleTokens.some((word) => matches(token, word))) score += 2;
    if (contentTokens.some((word) => matches(token, word))) score += 1;
  }
  return score;
}

/**
 * Picks the most relevant topics for a question. Falls back to the general
 * topics when nothing scores, so the model always has something grounded
 * to work from.
 */
export function selectTopics(
  question: string,
  topics: HelpTopic[],
  limit = 3
): HelpTopic[] {
  const queryTokens = tokenize(question);
  const scored: ScoredTopic[] = topics
    .map((topic) => ({ topic, score: scoreTopic(queryTokens, topic) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const fallbackIds = new Set(["getting-started", "help-escalation"]);
    return topics.filter((topic) => fallbackIds.has(topic.id));
  }
  return scored.slice(0, limit).map((entry) => entry.topic);
}
