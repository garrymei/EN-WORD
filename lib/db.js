import mysql from "mysql2/promise";

let poolPromise;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS words (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      word VARCHAR(128) NOT NULL,
      normalized_word VARCHAR(128) NOT NULL UNIQUE,
      user_meaning TEXT,
      system_meaning TEXT,
      meaning_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      english_definition TEXT,
      phonetic_us VARCHAR(255),
      phonetic_uk VARCHAR(255),
      audio_us TEXT,
      audio_uk TEXT,
      part_of_speech VARCHAR(64),
      source VARCHAR(255),
      validation_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      base_weight INT NOT NULL DEFAULT 10,
      last_seen_at DATETIME NULL,
      last_answered_at DATETIME NULL,
      last_correct_at DATETIME NULL,
      last_wrong_at DATETIME NULL,
      typing_error_count INT NOT NULL DEFAULT 0,
      wrong_count INT NOT NULL DEFAULT 0,
      correct_count INT NOT NULL DEFAULT 0,
      seen_count INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS word_phrases (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      word_id BIGINT UNSIGNED NOT NULL,
      phrase TEXT NOT NULL,
      masked_phrase TEXT NOT NULL,
      sentence TEXT NOT NULL,
      sentence_translation TEXT,
      usage_note TEXT,
      domain VARCHAR(128) NOT NULL DEFAULT 'business_project_management',
      phrase_weight INT NOT NULL DEFAULT 10,
      last_seen_at DATETIME NULL,
      seen_count INT NOT NULL DEFAULT 0,
      typing_error_count INT NOT NULL DEFAULT 0,
      wrong_count INT NOT NULL DEFAULT 0,
      correct_count INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_word_phrases_word_id (word_id),
      CONSTRAINT fk_word_phrases_word_id FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS study_records (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      word_id BIGINT UNSIGNED NOT NULL,
      phrase_id BIGINT UNSIGNED NULL,
      user_answer TEXT,
      is_correct TINYINT(1) NOT NULL,
      had_typing_error TINYINT(1) NOT NULL,
      was_skipped TINYINT(1) NOT NULL DEFAULT 0,
      weight_before INT NOT NULL,
      weight_after INT NOT NULL,
      weight_delta INT NOT NULL,
      reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_study_records_word_id (word_id),
      INDEX idx_study_records_phrase_id (phrase_id),
      CONSTRAINT fk_study_records_word_id FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
      CONSTRAINT fk_study_records_phrase_id FOREIGN KEY (phrase_id) REFERENCES word_phrases(id) ON DELETE SET NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id TINYINT NOT NULL PRIMARY KEY,
      daily_study_count INT NOT NULL DEFAULT 20,
      daily_new_count INT NOT NULL DEFAULT 10,
      daily_review_count INT NOT NULL DEFAULT 10,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    INSERT INTO settings (id)
    VALUES (1)
    ON DUPLICATE KEY UPDATE id = id
  `);
}

async function createPool() {
  const pool = mysql.createPool({
    host: requiredEnv("MYSQL_HOST"),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: requiredEnv("MYSQL_USER"),
    password: requiredEnv("MYSQL_PASSWORD"),
    database: requiredEnv("MYSQL_DATABASE"),
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4"
  });

  await migrate(pool);
  return pool;
}

export async function getDb() {
  if (!poolPromise) poolPromise = createPool();
  return poolPromise;
}

export async function rows(db, sql, params = []) {
  const [result] = await db.query(sql, params);
  return result;
}

export async function one(db, sql, params = []) {
  const result = await rows(db, sql, params);
  return result[0] || null;
}

export async function run(db, sql, params = []) {
  const [result] = await db.execute(sql, params);
  return result;
}

export function clampWeight(value) {
  return Math.max(1, Math.min(100, Number(value) || 10));
}

export function normalizeWord(word) {
  return String(word || "").trim().toLowerCase();
}

export function isValidWordShape(word) {
  return /^[a-z][a-z'-]*$/i.test(String(word || "").trim());
}
