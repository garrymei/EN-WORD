import { NextResponse } from "next/server";
import { z } from "zod";
import { clampWeight, getDb, one, run } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({
  word_id: z.number().int(),
  phrase_id: z.number().int().nullable(),
  user_answer: z.string().default(""),
  had_typing_error: z.boolean().default(false),
  was_skipped: z.boolean().default(false)
});

function deltaFor({ isCorrect, hadTypingError, wasSkipped }) {
  if (wasSkipped) return 3;
  if (isCorrect && !hadTypingError) return -2;
  if (isCorrect && hadTypingError) return 1;
  if (!isCorrect && hadTypingError) return 7;
  return 5;
}

export async function POST(request) {
  const payload = schema.parse(await request.json());
  const db = await getDb();
  const word = await one(db, "SELECT * FROM words WHERE id = ?", [payload.word_id]);
  if (!word) return NextResponse.json({ error: "Word not found" }, { status: 404 });

  const normalizedAnswer = payload.user_answer.trim().toLowerCase();
  const isCorrect = !payload.was_skipped && normalizedAnswer === String(word.normalized_word).toLowerCase();
  const before = Number(word.base_weight || 10);
  const delta = deltaFor({ isCorrect, hadTypingError: payload.had_typing_error, wasSkipped: payload.was_skipped });
  const after = clampWeight(before + delta);

  await run(
    db,
    `UPDATE words SET
      base_weight = ?,
      last_answered_at = CURRENT_TIMESTAMP,
      last_correct_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE last_correct_at END,
      last_wrong_at = CASE WHEN ? = 0 THEN CURRENT_TIMESTAMP ELSE last_wrong_at END,
      typing_error_count = typing_error_count + ?,
      wrong_count = wrong_count + ?,
      correct_count = correct_count + ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [
      after,
      isCorrect ? 1 : 0,
      isCorrect ? 1 : 0,
      payload.had_typing_error ? 1 : 0,
      isCorrect ? 0 : 1,
      isCorrect ? 1 : 0,
      payload.word_id
    ]
  );

  if (payload.phrase_id) {
    const phraseWeight = await one(db, "SELECT phrase_weight FROM word_phrases WHERE id = ?", [payload.phrase_id]);
    await run(
      db,
      `UPDATE word_phrases SET
        phrase_weight = ?,
        typing_error_count = typing_error_count + ?,
        wrong_count = wrong_count + ?,
        correct_count = correct_count + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        clampWeight((phraseWeight?.phrase_weight || 10) + delta),
        payload.had_typing_error ? 1 : 0,
        isCorrect ? 0 : 1,
        isCorrect ? 1 : 0,
        payload.phrase_id
      ]
    );
  }

  await run(
    db,
    `INSERT INTO study_records (
      word_id, phrase_id, user_answer, is_correct, had_typing_error, was_skipped,
      weight_before, weight_after, weight_delta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.word_id,
      payload.phrase_id,
      payload.user_answer,
      isCorrect ? 1 : 0,
      payload.had_typing_error ? 1 : 0,
      payload.was_skipped ? 1 : 0,
      before,
      after,
      after - before
    ]
  );

  return NextResponse.json({
    is_correct: isCorrect,
    correct_word: word.word,
    weight_before: before,
    weight_after: after,
    weight_delta: after - before
  });
}
