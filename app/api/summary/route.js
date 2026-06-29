import { NextResponse } from "next/server";
import { getDb, one, rows } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const db = await getDb();
  const counts = await one(
    db,
    `SELECT
      COUNT(*) AS total,
      CAST(COALESCE(SUM(CASE WHEN validation_status = 'valid' THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS valid,
      CAST(COALESCE(SUM(CASE WHEN meaning_status = 'conflict' THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS conflicts
    FROM words`
  );
  const today = await one(
    db,
    `SELECT
      COUNT(*) AS reviewed,
      CAST(COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS correct
    FROM study_records
    WHERE DATE(reviewed_at) = CURRENT_DATE()`
  );
  const hardWords = await rows(
    db,
    `SELECT word, system_meaning, base_weight, wrong_count, correct_count
    FROM words
    ORDER BY base_weight DESC, wrong_count DESC
    LIMIT 6`
  );
  return NextResponse.json({ counts, today, hardWords });
}
