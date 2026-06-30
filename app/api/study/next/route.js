import { NextResponse } from "next/server";
import { getDb, rows, run } from "@/lib/db";

export const runtime = "nodejs";

// #region debug-point C:reporter
const reportDebug = (hypothesisId, location, msg, data = {}, traceId = "") => (() => {
  const fs = require("fs");
  let url = "http://127.0.0.1:7777/event";
  let sessionId = "import-phrase-bug";
  try {
    const env = fs.readFileSync(".dbg/import-phrase-bug.env", "utf8");
    url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || url;
    sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || sessionId;
  } catch {}
  fetch(url, {
    method: "POST",
    body: JSON.stringify({ sessionId, runId: "pre-fix", hypothesisId, location, msg, data, traceId, ts: Date.now() })
  }).catch(() => {});
})();
// #endregion

function daysSince(value) {
  if (!value) return 30;
  const diff = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function effectiveWeight(word) {
  return Number(word.base_weight || 10) + Math.min(20, Math.floor(daysSince(word.last_seen_at) / 7));
}

function weightedPick(items, getWeight) {
  const total = items.reduce((sum, item) => sum + Math.max(1, getWeight(item)), 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= Math.max(1, getWeight(item));
    if (cursor <= 0) return item;
  }
  return items[0] || null;
}

function normalizeMeaningVariants(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isMalformedImportedItem(word) {
  const meaning = String(word.user_meaning || word.system_meaning || "").trim();
  return /^[—–\-:：]/.test(meaning);
}

export async function GET(request) {
  const traceId = `study-next-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const db = await getDb();
  const bookId = Number(new URL(request.url).searchParams.get("bookId") || 1);
  const rawCandidates = await rows(
    db,
    `SELECT * FROM words
    WHERE book_id = ?
      AND validation_status IN ('valid', 'pending')
      AND id IN (SELECT DISTINCT word_id FROM word_phrases)
    ORDER BY id DESC`,
    [bookId]
  );
  const candidates = rawCandidates.filter((word) => !isMalformedImportedItem(word));

  if (!candidates.length) {
    return NextResponse.json({ item: null });
  }

  const word = weightedPick(candidates, effectiveWeight);
  const phrases = await rows(
    db,
    `SELECT * FROM word_phrases WHERE word_id = ? ORDER BY seen_count ASC, last_seen_at ASC`,
    [word.id]
  );
  const phrase = weightedPick(phrases, (item) => Number(item.phrase_weight || 10) + Math.min(10, Math.floor(daysSince(item.last_seen_at) / 7)));

  await run(
    db,
    `UPDATE words SET last_seen_at = CURRENT_TIMESTAMP, seen_count = seen_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [word.id]
  );
  await run(
    db,
    `UPDATE word_phrases SET last_seen_at = CURRENT_TIMESTAMP, seen_count = seen_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [phrase.id]
  );
  // #region debug-point C:study-item
  reportDebug("C", "app/api/study/next/route.js:item", "[DEBUG] study item prepared", {
    book_id: bookId,
    word_id: word.id,
    word: word.word,
    normalized_word: word.normalized_word,
    meaning: word.user_meaning || word.system_meaning,
    phrase_id: phrase.id,
    phrase: phrase.phrase,
    masked_phrase: phrase.masked_phrase
  }, traceId);
  // #endregion
  return NextResponse.json({
    item: {
      word_id: word.id,
      phrase_id: phrase.id,
      word: word.word,
      meaning: word.user_meaning || word.system_meaning,
      system_meaning: word.system_meaning,
      meaning_variants: normalizeMeaningVariants(word.meaning_variants),
      english_definition: word.english_definition,
      phonetic_us: word.phonetic_us,
      phonetic_uk: word.phonetic_uk,
      audio_us: word.audio_us,
      audio_uk: word.audio_uk,
      base_weight: word.base_weight,
      masked_phrase: phrase.masked_phrase,
      phrase: phrase.phrase,
      phrase_translation: phrase.phrase_translation,
      sentence: phrase.sentence,
      sentence_translation: phrase.sentence_translation,
      usage_note: phrase.usage_note
    }
  });
}
