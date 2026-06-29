import { NextResponse } from "next/server";
import { getDb, rows } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const db = await getDb();
  const words = await rows(
    db,
    `SELECT
      w.*,
      COALESCE(pc.phrase_count, 0) AS phrase_count
    FROM words w
    LEFT JOIN (
      SELECT word_id, COUNT(*) AS phrase_count
      FROM word_phrases
      GROUP BY word_id
    ) pc ON pc.word_id = w.id
    ORDER BY w.updated_at DESC, w.id DESC`
  );
  return NextResponse.json({ words });
}
