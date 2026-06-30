import { NextResponse } from "next/server";
import { z } from "zod";
import { clampWeight, getDb, one, rows, run } from "@/lib/db";

export const runtime = "nodejs";

const updateSchema = z.object({
  id: z.number().int().positive(),
  base_weight: z.number().int().min(1).max(100).optional(),
  validation_status: z.enum(["valid", "pending", "invalid"]).optional()
});

const deleteSchema = z.object({
  id: z.number().int().positive()
});

export async function GET(request) {
  const db = await getDb();
  const bookId = Number(new URL(request.url).searchParams.get("bookId") || 1);
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
    WHERE w.book_id = ?
    ORDER BY w.updated_at DESC, w.id DESC`,
    [bookId]
  );
  return NextResponse.json({ words });
}

export async function PUT(request) {
  const payload = updateSchema.parse(await request.json());
  const db = await getDb();
  const current = await one(db, "SELECT * FROM words WHERE id = ?", [payload.id]);
  if (!current) return NextResponse.json({ error: "Word not found" }, { status: 404 });

  await run(
    db,
    `UPDATE words
    SET base_weight = ?, validation_status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [
      payload.base_weight === undefined ? current.base_weight : clampWeight(payload.base_weight),
      payload.validation_status ?? current.validation_status,
      payload.id
    ]
  );

  const word = await one(db, "SELECT * FROM words WHERE id = ?", [payload.id]);
  return NextResponse.json({ word });
}

export async function DELETE(request) {
  const payload = deleteSchema.parse(await request.json());
  const db = await getDb();
  const current = await one(db, "SELECT id FROM words WHERE id = ?", [payload.id]);
  if (!current) return NextResponse.json({ error: "Word not found" }, { status: 404 });

  await run(db, "DELETE FROM words WHERE id = ?", [payload.id]);
  return NextResponse.json({ success: true });
}
