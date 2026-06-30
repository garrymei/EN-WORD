import { NextResponse } from "next/server";
import { getDb, one, rows } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request) {
  const db = await getDb();
  const bookId = Number(new URL(request.url).searchParams.get("bookId") || 1);
  const counts = await one(
    db,
    `SELECT
      COUNT(*) AS total,
      CAST(COALESCE(SUM(CASE WHEN validation_status = 'valid' THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS valid,
      CAST(COALESCE(SUM(CASE WHEN meaning_status = 'conflict' THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS conflicts
    FROM words
    WHERE book_id = ?`,
    [bookId]
  );
  const today = await one(
    db,
    `SELECT
      COUNT(*) AS reviewed,
      CAST(COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS correct
    FROM study_records
    INNER JOIN words ON words.id = study_records.word_id
    WHERE DATE(reviewed_at) = CURRENT_DATE()
      AND words.book_id = ?`,
    [bookId]
  );
  const hardWords = await rows(
    db,
    `SELECT word, system_meaning, base_weight, wrong_count, correct_count
    FROM words
    WHERE book_id = ?
    ORDER BY base_weight DESC, wrong_count DESC
    LIMIT 6`,
    [bookId]
  );
  return NextResponse.json({ counts, today, hardWords });
}
