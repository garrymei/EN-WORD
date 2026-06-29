import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isValidWordShape, normalizeWord, one, run } from "@/lib/db";
import { lookupDictionary } from "@/lib/dictionary";
import { enrichWord } from "@/lib/enrichment";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().min(1)
});

function parseLine(line) {
  const trimmed = line.trim();
  const match = trimmed.match(/^([A-Za-z][A-Za-z'-]*)(?:\s+(.+))?$/);
  if (!match) return null;
  return {
    word: match[1],
    userMeaning: match[2]?.trim() || ""
  };
}

export async function POST(request) {
  const payload = requestSchema.parse(await request.json());
  const db = await getDb();
  const lines = payload.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const results = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed || !isValidWordShape(parsed.word)) {
      results.push({ line, status: "invalid", reason: "英文单词格式不合法" });
      continue;
    }

    const normalized = normalizeWord(parsed.word);
    const existing = await one(db, "SELECT id FROM words WHERE normalized_word = ?", [normalized]);
    if (existing) {
      results.push({ line, word: normalized, status: "duplicate", reason: "单词已存在" });
      continue;
    }

    const dictionary = await lookupDictionary(normalized);
    const enrichment = await enrichWord({
      word: normalized,
      userMeaning: parsed.userMeaning,
      dictionary
    });

    const validationStatus = dictionary.found ? "valid" : "pending";
    const meaningStatus = parsed.userMeaning
      ? enrichment.meaning_match
        ? "confirmed"
        : "conflict"
      : enrichment.system_meaning
        ? "empty"
        : "pending";

    const insertResult = await run(
      db,
      `INSERT INTO words (
        word, normalized_word, user_meaning, system_meaning, meaning_status,
        english_definition, phonetic_us, phonetic_uk, audio_us, audio_uk,
        part_of_speech, source, validation_status, base_weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dictionary.word || parsed.word,
        normalized,
        parsed.userMeaning,
        enrichment.system_meaning,
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

    const wordId = insertResult.insertId;
    for (const phrase of enrichment.phrases.slice(0, 8)) {
      await run(
        db,
        `INSERT INTO word_phrases (
          word_id, phrase, masked_phrase, sentence, sentence_translation, usage_note, domain
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          wordId,
          phrase.phrase,
          phrase.masked_phrase,
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
