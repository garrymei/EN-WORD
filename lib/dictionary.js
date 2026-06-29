export async function lookupDictionary(word) {
  const normalized = word.toLowerCase();
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`, {
      next: { revalidate: 60 * 60 * 24 * 30 }
    });
    if (!response.ok) return { found: false };
    const [entry] = await response.json();
    const meanings = entry?.meanings || [];
    const firstMeaning = meanings[0];
    const definition = firstMeaning?.definitions?.[0]?.definition || "";
    const partOfSpeech = firstMeaning?.partOfSpeech || "";
    const phonetics = entry?.phonetics || [];
    const audio = phonetics.find((item) => item.audio)?.audio || "";
    const phonetic = phonetics.find((item) => item.text)?.text || entry?.phonetic || "";

    return {
      found: true,
      word: entry?.word || normalized,
      english_definition: definition,
      part_of_speech: partOfSpeech,
      phonetic_us: phonetic,
      phonetic_uk: phonetic,
      audio_us: audio,
      audio_uk: audio,
      source: "dictionaryapi.dev"
    };
  } catch {
    return { found: false };
  }
}
