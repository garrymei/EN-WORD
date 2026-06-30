function maskWordInPhrase(phrase, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = phrase.replace(new RegExp(escaped, "i"), "_____");
  if (direct !== phrase) return direct;
  return phrase.replace(new RegExp(`\\b${escaped}\\b`, "i"), "_____");
}

function fallbackMeaning(word, userMeaning) {
  return userMeaning || `待补充：${word}`;
}

function buildMeaningVariants(primaryMeaning, userMeaning = "") {
  const parts = `${primaryMeaning || ""}；${userMeaning || ""}`
    .split(/[;；,，、]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^也可表示/, "").trim())
    .filter(Boolean);

  return [...new Set(parts)]
    .filter((item) => item !== primaryMeaning)
    .slice(0, 8);
}

function fallbackPhrases(word, meaning) {
  const templates = [
    {
      phrase: `${word} in the project plan`,
      phrase_translation: `项目计划中的 ${word}`,
      sentence: `The project manager used "${word}" in the project plan to make the next step clearer.`,
      sentence_translation: `项目经理在项目计划中使用了 ${word}，让下一步更清楚。`,
      usage_note: `这是无大模型配置时的兜底短语，用于把单词放进项目计划语境中。`
    },
    {
      phrase: `${word} during stakeholder review`,
      phrase_translation: `干系人评审中的 ${word}`,
      sentence: `The team discussed "${word}" during stakeholder review before finalizing the timeline.`,
      sentence_translation: `团队在最终确定时间线之前，在干系人评审中讨论了 ${word}。`,
      usage_note: `这是无大模型配置时的兜底短语，用于干系人评审和排期讨论场景。`
    },
    {
      phrase: `${word} for delivery risk`,
      phrase_translation: `交付风险场景中的 ${word}`,
      sentence: `We added "${word}" to the delivery risk discussion in the weekly project meeting.`,
      sentence_translation: `我们在每周项目会议的交付风险讨论中加入了 ${word}。`,
      usage_note: `这是无大模型配置时的兜底短语，用于交付风险和周会复盘场景。`
    }
  ];

  return templates.map((item) => ({
    ...item,
    masked_phrase: maskWordInPhrase(item.phrase, word),
    domain: "business_project_management",
    meaning
  }));
}

function getModelConfig() {
  const apiKey = process.env.ARK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: process.env.LLM_BASE_URL || process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3/responses",
    model: process.env.LLM_MODEL || process.env.ARK_MODEL || process.env.OPENAI_MODEL || "doubao-seed-2-1-pro-260628",
    source: process.env.LLM_SOURCE || (process.env.ARK_API_KEY ? "volcengine-ark" : "openai")
  };
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;

  const contentItems = data.output?.flatMap((item) => item.content || []) || [];
  for (const item of contentItems) {
    if (typeof item.text === "string") return item.text;
    if (typeof item.content === "string") return item.content;
  }

  const message = data.choices?.[0]?.message?.content;
  if (typeof message === "string") return message;
  return "";
}

function parseJsonOutput(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty model output");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model output is not JSON");
    return JSON.parse(match[0]);
  }
}

function debugModel(message, detail) {
  if (process.env.LLM_DEBUG !== "1") return;
  console.warn(`[LLM] ${message}`, detail || "");
}

function getImportTimeoutMs() {
  const configured = Number(process.env.LLM_TIMEOUT_MS || 60000);
  if (!Number.isFinite(configured) || configured <= 0) return 8000;
  return Math.min(configured, 8000);
}

export async function enrichWord({ word, userMeaning, dictionary }) {
  const config = getModelConfig();
  if (!config) {
    const meaning = fallbackMeaning(word, userMeaning);
    return {
      meaning_match: Boolean(userMeaning),
      system_meaning: meaning,
      meaning_variants: buildMeaningVariants(meaning, userMeaning),
      phrases: fallbackPhrases(word, meaning),
      source: dictionary?.source || "fallback"
    };
  }

  const prompt = {
    task: "Return one minified JSON object only. No markdown. No explanation.",
    word,
    user_meaning: userMeaning || "",
    dictionary_definition: dictionary?.english_definition || "",
    rules: "Use Chinese for system_meaning, meaning_variants, phrase_translation, sentence_translation and usage_note. system_meaning is the primary concise Chinese meaning. meaning_variants is an array of other common Chinese meanings or senses of the word, 2 to 6 short items, no explanations. Create 5 practical business or project-management phrases. Each phrase should contain the target word. masked_phrase replaces the target word with _____. phrase_translation must be only the direct Chinese translation of the phrase itself, not the word definition, not a full sentence, not usage explanation. Keep phrase_translation concise.",
    schema: '{"meaning_match":true,"system_meaning":"主要中文释义","meaning_variants":["其他释义1","其他释义2"],"phrases":[{"phrase":"...","masked_phrase":"...","phrase_translation":"该短语的直接中文翻译","sentence":"...","sentence_translation":"完整例句中文翻译","usage_note":"中文用法讲解"}]}'
  };

  const body = {
    model: config.model,
    max_output_tokens: Number(process.env.LLM_MAX_OUTPUT_TOKENS || 1800),
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "Return valid JSON only."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(prompt)
          }
        ]
      }
    ]
  };

  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), getImportTimeoutMs());
    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const outputText = extractOutputText(data);
    debugModel("output", outputText.slice(0, 1000));
    const parsed = parseJsonOutput(outputText);
    if (!Array.isArray(parsed.phrases)) throw new Error("Missing phrases array");
    const meaningVariants = Array.isArray(parsed.meaning_variants)
      ? parsed.meaning_variants.filter(Boolean).slice(0, 8)
      : buildMeaningVariants(parsed.system_meaning, userMeaning);
    const phrases = parsed.phrases.map((item) => ({
      ...item,
      masked_phrase: item.masked_phrase?.includes("_____") ? item.masked_phrase : maskWordInPhrase(item.phrase, word),
      domain: "business_project_management"
    }));
    return { ...parsed, meaning_variants: meaningVariants, phrases, source: config.source };
  } catch (error) {
    debugModel("fallback", error?.message);
    const meaning = fallbackMeaning(word, userMeaning);
    return {
      meaning_match: Boolean(userMeaning),
      system_meaning: meaning,
      meaning_variants: buildMeaningVariants(meaning, userMeaning),
      phrases: fallbackPhrases(word, meaning),
      source: dictionary?.source || "fallback"
    };
  } finally {
    clearTimeout(timeout);
  }
}
