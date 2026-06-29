import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, one, run } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({
  daily_study_count: z.number().int().min(1).max(200)
});

export async function GET() {
  const db = await getDb();
  const settings = await one(db, "SELECT * FROM settings WHERE id = 1");
  return NextResponse.json({ settings });
}

export async function PUT(request) {
  const payload = schema.parse(await request.json());
  const db = await getDb();
  await run(
    db,
    "UPDATE settings SET daily_study_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
    [payload.daily_study_count]
  );
  return NextResponse.json({ settings: await one(db, "SELECT * FROM settings WHERE id = 1") });
}
