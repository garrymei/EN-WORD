import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function normalizeWord(word) {
  return String(word || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function maskWordInPhrase(phrase, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = phrase.replace(new RegExp(escaped, "i"), "_____");
  if (direct !== phrase) return direct;
  return phrase.replace(new RegExp(`\\b${escaped}\\b`, "i"), "_____");
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const contentItems = data.output?.flatMap((item) => item.content || []) || [];
  for (const item of contentItems) {
    if (typeof item.text === "string") return item.text;
    if (typeof item.content === "string") return item.content;
  }
  return "";
}

function parseJsonOutput(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model output is not JSON");
    return JSON.parse(match[0]);
  }
}

function shouldReplacePhrases(word) {
  return Number(word.bad_project_plan_phrases || 0) > 0 || Number(word.phrase_count || 0) === 0;
}

function shouldRepairMeanings(word) {
  return parseMeaningVariants(word.meaning_variants).length === 0 || !String(word.system_meaning || "").trim();
}

async function enrichBatch(batch) {
  const apiKey = requiredEnv("ARK_API_KEY");
  const model = process.env.LLM_MODEL || process.env.ARK_MODEL || "doubao-seed-2-1-pro-260628";
  const baseUrl = process.env.LLM_BASE_URL || process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3/responses";
  const prompt = {
    task: "Return one minified JSON object only. No markdown. No explanation.",
    words: batch.map((word) => ({
      id: word.id,
      word: normalizeWord(word.normalized_word || word.word),
      user_meaning: word.user_meaning || "",
      dictionary_definition: word.english_definition || ""
    })),
    rules: "For each item, use Chinese for system_meaning, meaning_variants, phrase_translation, sentence_translation and usage_note. meaning_variants is required and must contain 2 to 6 other common Chinese meanings or senses, not repeating system_meaning. Create 5 varied practical business or project-management phrases per word. Each phrase must contain the target word exactly or as a natural plural/inflected form. Avoid generic templates like 'in the project plan'. Prefer concrete scenes such as scope review, stakeholder alignment, budget approval, risk register, delivery roadmap, vendor negotiation, quarterly planning, release readiness, incident review, and executive update. phrase_translation is only the direct Chinese translation of the phrase itself.",
    schema: '{"items":[{"id":1,"word":"...","system_meaning":"主要中文释义","meaning_variants":["其他释义1","其他释义2"],"phrases":[{"phrase":"...","phrase_translation":"短语中文","sentence":"...","sentence_translation":"例句中文","usage_note":"中文用法讲解"}]}]}'
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.LLM_TIMEOUT_MS || 90000));
  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_output_tokens: Number(process.env.LLM_MAX_OUTPUT_TOKENS || 5000),
        thinking: { type: "disabled" },
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: "Return valid JSON only." }]
          },
          {
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify(prompt) }]
          }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(await response.text());
    const parsed = parseJsonOutput(extractOutputText(await response.json()));
    if (!Array.isArray(parsed.items)) throw new Error("Missing items array");
    return new Map(parsed.items.map((item) => [Number(item.id), item]));
  } finally {
    clearTimeout(timeout);
  }
}

loadEnv(path.resolve(process.cwd(), ".env.local"));

const limit = Number(process.argv[2] || 0);
const batchSize = Number(process.env.REPAIR_BATCH_SIZE || 3);
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

  const candidates = (limit > 0 ? words.slice(0, limit) : words).filter(
    (word) => shouldRepairMeanings(word) || shouldReplacePhrases(word)
  );
  console.log(`repair candidates: ${candidates.length}${limit > 0 ? ` of ${words.length}` : ""}`);

  let repairedMeanings = 0;
  let repairedPhrases = 0;
  let failed = 0;

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    let enriched;
    try {
      enriched = await enrichBatch(batch);
    } catch (error) {
      failed += batch.length;
      console.error(`failed batch ${index + 1}-${index + batch.length}: ${error.message}`);
      continue;
    }

    for (const word of batch) {
      const item = enriched.get(Number(word.id));
      if (!item) {
        failed += 1;
        console.error(`failed ${word.word}: missing model item`);
        continue;
      }

      const repairMeanings = shouldRepairMeanings(word);
      const replacePhrases = shouldReplacePhrases(word);
      const variants = Array.isArray(item.meaning_variants)
        ? item.meaning_variants
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .filter((value, pos, list) => list.indexOf(value) === pos)
            .filter((value) => value !== item.system_meaning)
            .slice(0, 8)
        : [];

      if (repairMeanings) {
        await pool.execute(
          `UPDATE words
           SET system_meaning = ?, meaning_variants = ?, source = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            item.system_meaning || word.system_meaning || word.user_meaning || "",
            JSON.stringify(variants),
            process.env.LLM_SOURCE || "volcengine-ark",
            word.id
          ]
        );
        repairedMeanings += 1;
      }

      if (replacePhrases) {
        await pool.execute("DELETE FROM word_phrases WHERE word_id = ?", [word.id]);
        for (const phrase of (item.phrases || []).slice(0, 8)) {
          const normalized = normalizeWord(word.normalized_word || word.word);
          await pool.execute(
            `INSERT INTO word_phrases (
              word_id, phrase, masked_phrase, phrase_translation, sentence, sentence_translation, usage_note, domain
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              word.id,
              phrase.phrase,
              phrase.masked_phrase?.includes("_____") ? phrase.masked_phrase : maskWordInPhrase(phrase.phrase || "", normalized),
              phrase.phrase_translation || "",
              phrase.sentence || "",
              phrase.sentence_translation || "",
              phrase.usage_note || "",
              "business_project_management"
            ]
          );
        }
        repairedPhrases += 1;
      }

      console.log(`repaired ${normalizeWord(word.normalized_word || word.word)}: meanings=${repairMeanings} phrases=${replacePhrases}`);
    }
  }

  console.log(`done: meanings=${repairedMeanings}, phrases=${repairedPhrases}, failed=${failed}`);
} finally {
  await pool.end();
}
