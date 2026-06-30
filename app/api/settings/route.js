import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, one, run } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({
  book_id: z.number().int().positive().default(1),
  daily_study_count: z.number().int().min(1).max(200)
});

export async function GET(request) {
  const db = await getDb();
  const bookId = Number(new URL(request.url).searchParams.get("bookId") || 1);
  const settings = await one(
    db,
    `SELECT id, daily_study_count, daily_study_count AS daily_new_count, 0 AS daily_review_count
    FROM word_books
    WHERE id = ? AND is_active = 1`,
    [bookId]
  );
  return NextResponse.json({ settings });
}

export async function PUT(request) {
  const payload = schema.parse(await request.json());
  const db = await getDb();
  await run(
    db,
    "UPDATE word_books SET daily_study_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [payload.daily_study_count, payload.book_id]
  );
  return NextResponse.json({
    settings: await one(
      db,
      `SELECT id, daily_study_count, daily_study_count AS daily_new_count, 0 AS daily_review_count
      FROM word_books
      WHERE id = ?`,
      [payload.book_id]
    )
  });
}
