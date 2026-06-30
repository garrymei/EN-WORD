import mysql from "mysql2/promise";

let poolPromise;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS word_books (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      description TEXT,
      daily_study_count INT NOT NULL DEFAULT 20,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    INSERT INTO word_books (id, name, description)
    VALUES (1, '默认单词本', '自动创建的默认单词本')
    ON DUPLICATE KEY UPDATE id = id
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS words (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      book_id BIGINT UNSIGNED NOT NULL DEFAULT 1,
      word VARCHAR(128) NOT NULL,
      normalized_word VARCHAR(128) NOT NULL,
      user_meaning TEXT,
      system_meaning TEXT,
      meaning_variants JSON,
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
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_words_book_id (book_id),
      UNIQUE KEY uniq_words_book_word (book_id, normalized_word)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await ensureColumn(pool, "words", "book_id", "BIGINT UNSIGNED NOT NULL DEFAULT 1");
  await ensureColumn(pool, "words", "meaning_variants", "JSON");
  await dropIndexIfExists(pool, "words", "normalized_word");
  await addIndexIfMissing(pool, "words", "idx_words_book_id", "INDEX idx_words_book_id (book_id)");
  await addIndexIfMissing(pool, "words", "uniq_words_book_word", "UNIQUE KEY uniq_words_book_word (book_id, normalized_word)");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS word_phrases (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      word_id BIGINT UNSIGNED NOT NULL,
      phrase TEXT NOT NULL,
      masked_phrase TEXT NOT NULL,
      phrase_translation TEXT,
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

  await ensureColumn(pool, "word_phrases", "phrase_translation", "TEXT");

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

async function ensureColumn(pool, table, column, definition) {
  const [columns] = await pool.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  if (columns.length === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function dropIndexIfExists(pool, table, indexName) {
  const [indexes] = await pool.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [indexName]);
  if (indexes.length > 0) {
    await pool.query(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
  }
}

async function addIndexIfMissing(pool, table, indexName, definition) {
  const [indexes] = await pool.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [indexName]);
  if (indexes.length === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
  }
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
  try {
    const [result] = await db.query(sql, params);
    return result;
  } catch (error) {
    if (isRetryableDbError(error)) {
      const [result] = await db.query(sql, params);
      return result;
    }
    throw error;
  }
}

export async function one(db, sql, params = []) {
  const result = await rows(db, sql, params);
  return result[0] || null;
}

export async function run(db, sql, params = []) {
  try {
    const [result] = await db.execute(sql, params);
    return result;
  } catch (error) {
    if (isRetryableDbError(error)) {
      const [result] = await db.execute(sql, params);
      return result;
    }
    throw error;
  }
}

function isRetryableDbError(error) {
  return ["ECONNRESET", "PROTOCOL_CONNECTION_LOST", "ETIMEDOUT", "EPIPE"].includes(error?.code);
}

export function clampWeight(value) {
  return Math.max(1, Math.min(100, Number(value) || 10));
}

export function normalizeWord(word) {
  return String(word || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isValidWordShape(word) {
  const trimmed = String(word || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9&/.'() -]*[A-Za-z0-9)]$/i.test(trimmed) && /[A-Za-z]/.test(trimmed);
}
