function maskWordInPhrase(phrase, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return phrase.replace(new RegExp(`\\b${escaped}\\b`, "i"), "_____");
}

function fallbackMeaning(word, userMeaning) {
  return userMeaning || `待补充：${word}`;
}

function fallbackPhrases(word, meaning) {
  const templates = [
    {
      phrase: `${word} in the project plan`,
      sentence: `The project manager used "${word}" in the project plan to make the next step clearer.`,
      sentence_translation: `项目经理在项目计划中使用了 ${word}，让下一步更清楚。`,
      usage_note: `这是无大模型配置时的兜底短语，用于把单词放进项目计划语境中。`
    },
    {
      phrase: `${word} during stakeholder review`,
      sentence: `The team discussed "${word}" during stakeholder review before finalizing the timeline.`,
      sentence_translation: `团队在最终确定时间线之前，在干系人评审中讨论了 ${word}。`,
      usage_note: `这是无大模型配置时的兜底短语，用于干系人评审和排期讨论场景。`
    },
    {
      phrase: `${word} for delivery risk`,
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

export async function enrichWord({ word, userMeaning, dictionary }) {
  if (!process.env.OPENAI_API_KEY) {
    const meaning = fallbackMeaning(word, userMeaning);
    return {
      meaning_match: Boolean(userMeaning),
      system_meaning: meaning,
      phrases: fallbackPhrases(word, meaning),
      source: dictionary?.source || "fallback"
    };
  }

  const body = {
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You generate concise Chinese learning data for an English vocabulary app. Return only valid JSON."
      },
      {
        role: "user",
        content: JSON.stringify({
          word,
          user_meaning: userMeaning || "",
          dictionary_definition: dictionary?.english_definition || "",
          domain: "business, workplace, project management, meetings, delivery, risk, planning",
          schema: {
            meaning_match: "boolean",
            system_meaning: "Chinese meaning",
            phrases: [
              {
                phrase: "business/project phrase containing the word exactly",
                masked_phrase: "same phrase with target word replaced by _____",
                sentence: "English sentence using the phrase",
                sentence_translation: "Chinese translation",
                usage_note: "Chinese usage explanation"
              }
            ]
          },
          phrase_count: 5
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "word_enrichment",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["meaning_match", "system_meaning", "phrases"],
          properties: {
            meaning_match: { type: "boolean" },
            system_meaning: { type: "string" },
            phrases: {
              type: "array",
              minItems: 3,
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["phrase", "masked_phrase", "sentence", "sentence_translation", "usage_note"],
                properties: {
                  phrase: { type: "string" },
                  masked_phrase: { type: "string" },
                  sentence: { type: "string" },
                  sentence_translation: { type: "string" },
                  usage_note: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const outputText = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text;
    const parsed = JSON.parse(outputText);
    const phrases = parsed.phrases.map((item) => ({
      ...item,
      masked_phrase: item.masked_phrase?.includes("_____") ? item.masked_phrase : maskWordInPhrase(item.phrase, word),
      domain: "business_project_management"
    }));
    return { ...parsed, phrases, source: "openai" };
  } catch {
    const meaning = fallbackMeaning(word, userMeaning);
    return {
      meaning_match: Boolean(userMeaning),
      system_meaning: meaning,
      phrases: fallbackPhrases(word, meaning),
      source: dictionary?.source || "fallback"
    };
  }
}
