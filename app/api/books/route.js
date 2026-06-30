import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, one, rows, run } from "@/lib/db";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().default("")
});

const updateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  daily_study_count: z.number().int().min(1).max(200).optional()
});

export async function GET() {
  const db = await getDb();
  const books = await rows(
    db,
    `SELECT
      b.*,
      COALESCE(wc.word_count, 0) AS word_count
    FROM word_books b
    LEFT JOIN (
      SELECT book_id, COUNT(*) AS word_count
      FROM words
      GROUP BY book_id
    ) wc ON wc.book_id = b.id
    WHERE b.is_active = 1
    ORDER BY b.updated_at DESC, b.id DESC`
  );
  return NextResponse.json({ books });
}

export async function POST(request) {
  const payload = createSchema.parse(await request.json());
  const db = await getDb();
  const result = await run(
    db,
    "INSERT INTO word_books (name, description) VALUES (?, ?)",
    [payload.name, payload.description]
  );
  const book = await one(db, "SELECT * FROM word_books WHERE id = ?", [result.insertId]);
  return NextResponse.json({ book });
}

export async function PUT(request) {
  const payload = updateSchema.parse(await request.json());
  const db = await getDb();
  const current = await one(db, "SELECT * FROM word_books WHERE id = ?", [payload.id]);
  if (!current) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  await run(
    db,
    `UPDATE word_books
    SET name = ?, description = ?, daily_study_count = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [
      payload.name ?? current.name,
      payload.description ?? current.description,
      payload.daily_study_count ?? current.daily_study_count,
      payload.id
    ]
  );
  const book = await one(db, "SELECT * FROM word_books WHERE id = ?", [payload.id]);
  return NextResponse.json({ book });
}
