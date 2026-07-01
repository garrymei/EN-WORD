import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { enrichWord } from "../lib/enrichment.js";
import { lookupDictionary } from "../lib/dictionary.js";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseMeaningVariants(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function shouldReplacePhrases(word) {
  return Number(word.bad_project_plan_phrases || 0) > 0 || Number(word.phrase_count || 0) === 0;
}

function shouldRepairMeanings(word) {
  return parseMeaningVariants(word.meaning_variants).length === 0 || !String(word.system_meaning || "").trim();
}

function normalizeWord(word) {
  return String(word || "").trim().replace(/\s+/g, " ").toLowerCase();
}

loadEnv(path.resolve(process.cwd(), ".env.local"));

const limit = Number(process.argv[2] || 0);
const pool = mysql.createPool({
  host: requiredEnv("MYSQL_HOST"),
  port: Number(process.env.MYSQL_PORT || 3306),
  user: requiredEnv("MYSQL_USER"),
  password: requiredEnv("MYSQL_PASSWORD"),
  database: requiredEnv("MYSQL_DATABASE"),
  waitForConnections: true,
  connectionLimit: 3,
  charset: "utf8mb4"
});

try {
  const [words] = await pool.query(`
    SELECT
      w.*,
      COUNT(p.id) AS phrase_count,
      SUM(CASE
        WHEN LOWER(p.phrase) LIKE CONCAT('%', LOWER(w.normalized_word), ' in the project plan%') THEN 1
        WHEN LOWER(p.masked_phrase) LIKE '%_____ in the project plan%' THEN 1
        ELSE 0
      END) AS bad_project_plan_phrases
    FROM words w
    LEFT JOIN word_phrases p ON p.word_id = w.id
    GROUP BY w.id
    HAVING bad_project_plan_phrases > 0
      OR phrase_count = 0
      OR meaning_variants IS NULL
      OR JSON_LENGTH(meaning_variants) = 0
    ORDER BY w.id DESC
  `);

  const candidates = limit > 0 ? words.slice(0, limit) : words;
  console.log(`repair candidates: ${candidates.length}${limit > 0 ? ` of ${words.length}` : ""}`);

  let repairedMeanings = 0;
  let repairedPhrases = 0;
  let failed = 0;

  for (const word of candidates) {
    const normalized = normalizeWord(word.normalized_word || word.word);
    const repairMeanings = shouldRepairMeanings(word);
    const replacePhrases = shouldReplacePhrases(word);
    if (!repairMeanings && !replacePhrases) continue;

    try {
      const dictionary = /^[A-Za-z][A-Za-z'-]*$/.test(normalized)
        ? await lookupDictionary(normalized)
        : {
            found: false,
            english_definition: word.english_definition || "",
            source: word.source || ""
          };
      const enrichment = await enrichWord({
        word: normalized,
        userMeaning: word.user_meaning || "",
        dictionary
      });

      if (repairMeanings) {
        await pool.execute(
          `UPDATE words
           SET system_meaning = ?, meaning_variants = ?, source = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            enrichment.system_meaning || word.system_meaning || word.user_meaning || "",
            JSON.stringify(enrichment.meaning_variants || []),
            enrichment.source || word.source || "",
            word.id
          ]
        );
        repairedMeanings += 1;
      }

      if (replacePhrases) {
        await pool.execute("DELETE FROM word_phrases WHERE word_id = ?", [word.id]);
        for (const phrase of (enrichment.phrases || []).slice(0, 8)) {
          await pool.execute(
            `INSERT INTO word_phrases (
              word_id, phrase, masked_phrase, phrase_translation, sentence, sentence_translation, usage_note, domain
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              word.id,
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
        repairedPhrases += 1;
      }

      console.log(`repaired ${normalized}: meanings=${repairMeanings} phrases=${replacePhrases}`);
    } catch (error) {
      failed += 1;
      console.error(`failed ${normalized}: ${error.message}`);
    }
  }

  console.log(`done: meanings=${repairedMeanings}, phrases=${repairedPhrases}, failed=${failed}`);
} finally {
  await pool.end();
}
