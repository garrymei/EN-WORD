import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isValidWordShape, normalizeWord, one, run } from "@/lib/db";
import { lookupDictionary } from "@/lib/dictionary";
import { enrichWord } from "@/lib/enrichment";

export const runtime = "nodejs";

// #region debug-point A:reporter
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

const requestSchema = z.object({
  text: z.string().min(1),
  book_id: z.number().int().positive().default(1)
});

function parseLine(line) {
  const trimmed = line.trim();
  const chineseIndex = trimmed.search(/[\u3400-\u9fff]/);
  if (chineseIndex === -1) {
    return {
      word: trimmed.replace(/\s*(?:[-—–:：]+)\s*$/, "").trim(),
      userMeaning: ""
    };
  }

  const word = trimmed.slice(0, chineseIndex).replace(/\s*(?:[-—–:：]+)\s*$/, "").trim();
  const userMeaning = trimmed.slice(chineseIndex).trim();
  if (!word) return null;
  return {
    word,
    userMeaning
  };
}

function shouldLookupDictionary(word) {
  return /^[A-Za-z][A-Za-z'-]*$/.test(String(word || "").trim());
}

export async function POST(request) {
  const traceId = `import-phrase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = requestSchema.parse(await request.json());
  const db = await getDb();
  const book = await one(db, "SELECT id FROM word_books WHERE id = ? AND is_active = 1", [payload.book_id]);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  const lines = payload.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const results = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    // #region debug-point A:parse-line
    reportDebug("A", "app/api/import/route.js:parseLine", "[DEBUG] import line parsed", {
      line,
      parsed_word: parsed?.word || "",
      parsed_meaning: parsed?.userMeaning || "",
      is_valid_shape: parsed ? isValidWordShape(parsed.word) : false
    }, traceId);
    // #endregion
    if (!parsed || !isValidWordShape(parsed.word)) {
      results.push({ line, status: "invalid", reason: "英文单词格式不合法" });
      continue;
    }

    const normalized = normalizeWord(parsed.word);
    const existing = await one(db, "SELECT id FROM words WHERE book_id = ? AND normalized_word = ?", [payload.book_id, normalized]);
    if (existing) {
      results.push({ line, word: normalized, status: "duplicate", reason: "单词已存在" });
      continue;
    }

    const dictionary = shouldLookupDictionary(parsed.word) ? await lookupDictionary(normalized) : { found: false };
    const enrichment = await enrichWord({
      word: normalized,
      userMeaning: parsed.userMeaning,
      dictionary
    });

    const validationStatus = dictionary.found || normalized.includes(" ") ? "valid" : "pending";
    const meaningStatus = parsed.userMeaning
      ? enrichment.meaning_match
        ? "confirmed"
        : "conflict"
      : enrichment.system_meaning
        ? "empty"
        : "pending";

    const storedWord = shouldLookupDictionary(parsed.word) ? (dictionary.word || parsed.word) : parsed.word;
    const insertResult = await run(
      db,
      `INSERT INTO words (
        book_id, word, normalized_word, user_meaning, system_meaning, meaning_variants, meaning_status,
        english_definition, phonetic_us, phonetic_uk, audio_us, audio_uk,
        part_of_speech, source, validation_status, base_weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.book_id,
        storedWord,
        normalized,
        parsed.userMeaning,
        enrichment.system_meaning,
        JSON.stringify(enrichment.meaning_variants || []),
        meaningStatus,
        dictionary.english_definition || "",
        dictionary.phonetic_us || "",
        dictionary.phonetic_uk || "",
        dictionary.audio_us || "",
        dictionary.audio_uk || "",
        dictionary.part_of_speech || "",
        enrichment.source || dictionary.source || "",
        validationStatus,
        10
      ]
    );
    // #region debug-point B:stored-word
    reportDebug("B", "app/api/import/route.js:storedWord", "[DEBUG] import word stored", {
      insert_id: insertResult.insertId,
      stored_word: storedWord,
      normalized_word: normalized,
      user_meaning: parsed.userMeaning,
      system_meaning: enrichment.system_meaning,
      meaning_variants: enrichment.meaning_variants || [],
      validation_status: validationStatus,
      meaning_status: meaningStatus
    }, traceId);
    // #endregion

    const wordId = insertResult.insertId;
    for (const phrase of enrichment.phrases.slice(0, 8)) {
      await run(
        db,
        `INSERT INTO word_phrases (
          word_id, phrase, masked_phrase, phrase_translation, sentence, sentence_translation, usage_note, domain
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          wordId,
          phrase.phrase,
          phrase.masked_phrase,
          phrase.phrase_translation || "",
          phrase.sentence,
          phrase.sentence_translation,
          phrase.usage_note,
          phrase.domain || "business_project_management"
        ]
      );
    }

    results.push({
      line,
      word: normalized,
      status: validationStatus === "valid" && meaningStatus !== "conflict" ? "success" : meaningStatus,
      validation_status: validationStatus,
      meaning_status: meaningStatus
    });
  }

  const summary = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ summary, results });
}
