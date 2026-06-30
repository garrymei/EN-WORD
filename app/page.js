"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const tabs = [
  { id: "study", label: "背诵" },
  { id: "import", label: "导入" },
  { id: "words", label: "单词池" },
  { id: "stats", label: "统计" },
  { id: "settings", label: "设置" }
];

// #region debug-point A:reporter
const reportDebug = (hypothesisId, location, msg, data = {}, traceId = "") =>
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    body: JSON.stringify({ sessionId: "buttons-dead", runId: "pre-fix", hypothesisId, location, msg, data, traceId, ts: Date.now() })
  }).catch(() => {});
// #endregion

// #region debug-point B:autofocus-reporter
const reportAutofocusDebug = (hypothesisId, location, msg, data = {}, traceId = "") =>
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    body: JSON.stringify({ sessionId: "autofocus-refresh", runId: "pre-fix", hypothesisId, location, msg, data, traceId, ts: Date.now() })
  }).catch(() => {});
// #endregion

async function jsonFetch(url, options) {
  const traceId = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // #region debug-point A:request-start
  reportDebug("A", "app/page.js:jsonFetch:start", "[DEBUG] request started", {
    url,
    method: options?.method || "GET"
  }, traceId);
  // #endregion
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    }
  });
  const rawText = await response.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { rawText };
  }
  // #region debug-point B:request-finished
  reportDebug("B", "app/page.js:jsonFetch:end", "[DEBUG] request finished", {
    url,
    method: options?.method || "GET",
    status: response.status,
    ok: response.ok,
    body_preview: typeof rawText === "string" ? rawText.slice(0, 200) : ""
  }, traceId);
  // #endregion
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function formatAnswerForTarget(rawValue, target, previousValue = "") {
  const targetText = String(target || "");
  const rawText = String(rawValue || "");
  const isDeleting = rawText.length < String(previousValue || "").length;
  let formatted = "";
  let rawIndex = 0;
  let targetIndex = 0;

  while (rawIndex < rawText.length && targetIndex < targetText.length) {
    if (targetText[targetIndex] === " ") {
      formatted += " ";
      targetIndex += 1;
      if (rawText[rawIndex] === " ") rawIndex += 1;
      continue;
    }

    if (rawText[rawIndex] === " ") {
      rawIndex += 1;
      continue;
    }

    formatted += rawText[rawIndex];
    rawIndex += 1;
    targetIndex += 1;
  }

  if (!isDeleting) {
    while (targetIndex < targetText.length && targetText[targetIndex] === " ") {
      formatted += " ";
      targetIndex += 1;
    }
  }

  return formatted.slice(0, targetText.length);
}

function LetterBars({ word, value }) {
  const letters = Array.from(word || "");
  const typed = Array.from(value || "");
  return (
    <div className="letter-bars" aria-label="拼写反馈">
      {letters.map((letter, index) => {
        if (letter === " ") {
          return (
            <span className="letter-bar separator" key={`space-${index}`}>
              &nbsp;
            </span>
          );
        }
        const char = typed[index];
        const state = !char ? "empty" : char.toLowerCase() === letter.toLowerCase() ? "correct" : "wrong";
        return (
          <span className={`letter-bar ${state}`} key={`${letter}-${index}`}>
            {char || ""}
          </span>
        );
      })}
    </div>
  );
}

function BookSwitcher({ books, selectedBookId, setSelectedBookId, refreshBooks }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function createBook() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const data = await jsonFetch("/api/books", {
        method: "POST",
        body: JSON.stringify({ name: trimmed })
      });
      setName("");
      setSelectedBookId(Number(data.book.id));
      await refreshBooks(Number(data.book.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="book-switcher">
      <div className="book-select">
        <span>当前单词本</span>
        <select value={selectedBookId || ""} onChange={(event) => setSelectedBookId(Number(event.target.value))}>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.name}（{book.word_count || 0}）
            </option>
          ))}
        </select>
      </div>
      <div className="book-create">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="新建单词本" />
        <button onClick={createBook} disabled={busy || !name.trim()}>
          新建
        </button>
      </div>
    </section>
  );
}

function StudyPanel({ bookId, refreshAll }) {
  const [item, setItem] = useState(null);
  const [answer, setAnswer] = useState("");
  const [hadTypingError, setHadTypingError] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const answerInputRef = useRef(null);
  const autofocusTraceIdRef = useRef(`autofocus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  function focusAnswerInput() {
    if (result) return;
    // #region debug-point A:focus-called
    reportAutofocusDebug("A", "app/page.js:StudyPanel:focusAnswerInput", "[DEBUG] focus requested", {
      has_item: Boolean(item),
      loading,
      has_result: Boolean(result),
      has_ref_before_raf: Boolean(answerInputRef.current)
    }, autofocusTraceIdRef.current);
    // #endregion
    window.requestAnimationFrame(() => {
      // #region debug-point B:focus-raf
      reportAutofocusDebug("B", "app/page.js:StudyPanel:focusAnswerInput:raf", "[DEBUG] focus raf executed", {
        has_ref_in_raf: Boolean(answerInputRef.current),
        active_tag: document.activeElement?.tagName || "",
        active_placeholder: document.activeElement?.getAttribute?.("placeholder") || ""
      }, autofocusTraceIdRef.current);
      // #endregion
      answerInputRef.current?.focus();
    });
  }

  async function loadNext() {
    if (!bookId) return;
    setLoading(true);
    setAnswer("");
    setHadTypingError(false);
    setResult(null);
    try {
      const data = await jsonFetch(`/api/study/next?bookId=${bookId}`);
      setItem(data.item);
      // #region debug-point C:load-next-finished
      reportAutofocusDebug("C", "app/page.js:StudyPanel:loadNext", "[DEBUG] loadNext finished", {
        has_item: Boolean(data.item),
        item_word: data.item?.word || ""
      }, autofocusTraceIdRef.current);
      // #endregion
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNext();
  }, [bookId]);

  useEffect(() => {
    if (!item || result) return;
    focusAnswerInput();
  }, [item, result]);

  useEffect(() => {
    // #region debug-point D:state-changed
    reportAutofocusDebug("D", "app/page.js:StudyPanel:state", "[DEBUG] study panel state changed", {
      loading,
      has_item: Boolean(item),
      has_result: Boolean(result),
      has_ref: Boolean(answerInputRef.current)
    }, autofocusTraceIdRef.current);
    // #endregion
  }, [loading, item, result]);

  useEffect(() => {
    function handleWindowKeyDown(event) {
      if (event.key !== "Enter" || !result) return;
      event.preventDefault();
      loadNext();
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [result, bookId]);

  useEffect(() => {
    if (!item || !answer) return;
    const target = item.word.toLowerCase();
    const chars = Array.from(answer.toLowerCase());
    if (chars.some((char, index) => target[index] && char !== target[index])) {
      setHadTypingError(true);
    }
  }, [answer, item]);

  async function submit(wasSkipped = false) {
    if (!item) return;
    const data = await jsonFetch("/api/study/submit", {
      method: "POST",
      body: JSON.stringify({
        word_id: Number(item.word_id),
        phrase_id: Number(item.phrase_id),
        user_answer: answer,
        had_typing_error: hadTypingError,
        was_skipped: wasSkipped
      })
    });
    setResult(data);
    refreshAll();
  }

  function handleAnswerKeyDown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit(false);
  }

  function speak() {
    if (item?.audio_us) {
      new Audio(item.audio_us).play();
      return;
    }
    if ("speechSynthesis" in window && item?.word) {
      const utterance = new SpeechSynthesisUtterance(item.word);
      utterance.lang = "en-US";
      window.speechSynthesis.speak(utterance);
    }
  }

  if (loading) return <section className="panel">正在准备单词...</section>;

  if (!item) {
    return (
      <section className="panel empty-state">
        <h2>当前单词本还没有可背诵的单词</h2>
        <p>先在“导入”页把英文单词导入当前单词本。</p>
      </section>
    );
  }

  return (
    <section className="study-layout">
      <div className="prompt-area">
        <div className="eyebrow">当前权重 {item.base_weight}</div>
        <h1>{item.meaning || item.system_meaning || "待确认释义"}</h1>
        <div className="masked-phrase">{item.masked_phrase}</div>
        <input
          ref={answerInputRef}
          className="answer-input"
          value={answer}
          onChange={(event) => setAnswer((previous) => formatAnswerForTarget(event.target.value, item.word, previous))}
          onKeyDown={handleAnswerKeyDown}
          onMouseEnter={focusAnswerInput}
          placeholder="输入英文单词或短语"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          disabled={Boolean(result)}
        />
        <LetterBars word={item.word} value={answer} />
        <div className="action-row">
          <button className="primary" onClick={() => submit(false)} disabled={Boolean(result)}>
            提交
          </button>
          <button onClick={() => submit(true)} disabled={Boolean(result)}>
            跳过
          </button>
          <button onClick={speak}>发音</button>
        </div>
      </div>

      <aside className="explain-area">
        {!result ? (
          <>
            <h2>完成拼写后显示讲解</h2>
            <p>输入过程中只要出现过红杠，本次练习就会记录为拼写不稳定。</p>
          </>
        ) : (
          <>
            <div className={`result-pill ${result.is_correct ? "ok" : "bad"}`}>
              {result.is_correct ? "拼写正确" : "需要复习"}
            </div>
            <div className="answer-heading">
              <h2>
                {item.word} <span>{item.phonetic_us}</span>
                <button className="speaker-button" onClick={speak} type="button" aria-label="播放发音" title="播放发音">
                  🔊
                </button>
              </h2>
            </div>
            <p className="definition">{item.meaning || item.system_meaning || "待确认释义"}</p>
            {Array.isArray(item.meaning_variants) && item.meaning_variants.length > 0 && (
              <div className="meaning-variants">
                <span>其他解释</span>
                <div>
                  {item.meaning_variants.map((meaning) => (
                    <em key={meaning}>{meaning}</em>
                  ))}
                </div>
              </div>
            )}
            <p className="definition">{item.english_definition}</p>
            <dl>
              <dt>短语</dt>
              <dd>{item.phrase}</dd>
              {item.phrase_translation && <dd className="phrase-translation">{item.phrase_translation}</dd>}
              <dt>例句</dt>
              <dd>{item.sentence}</dd>
              <dt>翻译</dt>
              <dd>{item.sentence_translation}</dd>
              <dt>用法</dt>
              <dd>{item.usage_note}</dd>
              <dt>权重变化</dt>
              <dd>
                {result.weight_before} → {result.weight_after}
              </dd>
            </dl>
            <button className="primary wide" onClick={loadNext}>
              下一个
            </button>
          </>
        )}
      </aside>
    </section>
  );
}

function ImportPanel({ bookId, currentBook, refreshAll }) {
  const [text, setText] = useState("align 对齐\nprioritize 优先处理\nmitigate 缓解");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  async function submit() {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return;

    setBusy(true);
    setResult({ summary: {}, results: [] });
    setProgress({ done: 0, total: lines.length });

    const nextResult = { summary: {}, results: [] };
    try {
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        try {
          const data = await jsonFetch("/api/import", {
            method: "POST",
            body: JSON.stringify({ text: line, book_id: bookId })
          });
          for (const item of data.results) {
            nextResult.results.push(item);
            nextResult.summary[item.status] = (nextResult.summary[item.status] || 0) + 1;
          }
        } catch (error) {
          const item = { line, status: "failed", reason: error.message || "导入失败" };
          nextResult.results.push(item);
          nextResult.summary.failed = (nextResult.summary.failed || 0) + 1;
        }
        setProgress({ done: index + 1, total: lines.length });
        setResult({ summary: { ...nextResult.summary }, results: [...nextResult.results] });
        refreshAll();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>批量导入</h2>
          <p>导入到：{currentBook?.name || "当前单词本"}。每行一个英文单词或短语，中文释义可选。</p>
        </div>
        <button className="primary" onClick={submit} disabled={busy || !bookId}>
          {busy ? `导入中 ${progress.done}/${progress.total}` : "导入"}
        </button>
      </div>
      {busy && (
        <div className="progress-bar" aria-label="导入进度">
          <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
        </div>
      )}
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={"align 对齐\nProject Manager 项目经理"} />
      {result && (
        <div className="import-result">
          <h3>导入结果</h3>
          <div className="metric-grid compact">
            {Object.entries(result.summary).map(([key, value]) => (
              <div className="metric" key={key}>
                <span>{key}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <ul className="result-list">
            {result.results.map((row, index) => (
              <li key={`${row.line}-${index}`}>
                <span>{row.word || row.line}</span>
                <em>{row.status}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function WordsPanel({ words, currentBook, refreshAll }) {
  const [query, setQuery] = useState("");
  const [weightDrafts, setWeightDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    setWeightDrafts(
      Object.fromEntries(words.map((word) => [word.id, String(word.base_weight ?? 10)]))
    );
  }, [words]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return words;
    return words.filter((word) => `${word.word} ${word.user_meaning || ""} ${word.system_meaning || ""}`.toLowerCase().includes(keyword));
  }, [words, query]);

  async function updateWeight(word) {
    setBusyId(word.id);
    try {
      await jsonFetch("/api/words", {
        method: "PUT",
        body: JSON.stringify({
          id: Number(word.id),
          base_weight: Number(weightDrafts[word.id] || word.base_weight)
        })
      });
      await refreshAll();
    } finally {
      setBusyId(null);
    }
  }

  async function markInvalid(word) {
    setBusyId(word.id);
    try {
      await jsonFetch("/api/words", {
        method: "PUT",
        body: JSON.stringify({
          id: Number(word.id),
          validation_status: "invalid"
        })
      });
      await refreshAll();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteWord(word) {
    if (!window.confirm(`确认删除 ${word.word} 吗？`)) return;
    setBusyId(word.id);
    try {
      await jsonFetch("/api/words", {
        method: "DELETE",
        body: JSON.stringify({ id: Number(word.id) })
      });
      await refreshAll();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>单词池</h2>
          <p>{currentBook?.name || "当前单词本"} 中的单词、状态、权重和短语数量。</p>
        </div>
        <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" />
      </div>
      <div className="word-table">
        {filtered.map((word) => (
          <div className="word-row" key={word.id}>
            <div>
              <strong>{word.word}</strong>
              <span>{word.user_meaning || word.system_meaning}</span>
            </div>
            <div className="status-stack">
              <span>{word.validation_status}</span>
              <span>{word.meaning_status}</span>
            </div>
            <div>
              <input
                type="number"
                min="1"
                max="100"
                value={weightDrafts[word.id] ?? word.base_weight}
                onChange={(event) => setWeightDrafts((current) => ({ ...current, [word.id]: event.target.value }))}
                style={{ width: 72 }}
                disabled={busyId === word.id}
              />
              <button onClick={() => updateWeight(word)} disabled={busyId === word.id}>
                改权重
              </button>
            </div>
            <div>短语 {word.phrase_count}</div>
            <div>
              对 {word.correct_count} / 错 {word.wrong_count}
            </div>
            <div className="action-row">
              <button onClick={() => markInvalid(word)} disabled={busyId === word.id || word.validation_status === "invalid"}>
                置为无效
              </button>
              <button onClick={() => deleteWord(word)} disabled={busyId === word.id}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatsPanel({ summary, currentBook }) {
  const accuracy = summary?.today?.reviewed ? Math.round((summary.today.correct / summary.today.reviewed) * 100) : 0;
  return (
    <section className="panel">
      <h2>学习统计</h2>
      <p className="muted-line">{currentBook?.name || "当前单词本"}</p>
      <div className="metric-grid">
        <div className="metric">
          <span>单词总数</span>
          <strong>{summary?.counts?.total || 0}</strong>
        </div>
        <div className="metric">
          <span>可背诵</span>
          <strong>{summary?.counts?.valid || 0}</strong>
        </div>
        <div className="metric">
          <span>今日完成</span>
          <strong>{summary?.today?.reviewed || 0}</strong>
        </div>
        <div className="metric">
          <span>今日正确率</span>
          <strong>{accuracy}%</strong>
        </div>
      </div>
      <h3>高权重词</h3>
      <div className="hard-list">
        {(summary?.hardWords || []).map((word) => (
          <div key={word.word}>
            <strong>{word.word}</strong>
            <span>{word.system_meaning}</span>
            <em>{word.base_weight}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPanel({ bookId, currentBook, settings, refreshAll }) {
  const [count, setCount] = useState(settings?.daily_study_count || currentBook?.daily_study_count || 20);

  useEffect(() => {
    setCount(settings?.daily_study_count || currentBook?.daily_study_count || 20);
  }, [settings, currentBook]);

  async function save() {
    await jsonFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ book_id: bookId, daily_study_count: Number(count) })
    });
    refreshAll();
  }

  return (
    <section className="panel settings-panel">
      <h2>单词本设置</h2>
      <p className="muted-line">{currentBook?.name || "当前单词本"}</p>
      <label>
        每日背诵数量
        <input type="number" min="1" max="200" value={count} onChange={(event) => setCount(event.target.value)} />
      </label>
      <button className="primary" onClick={save}>保存设置</button>
    </section>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState("study");
  const [books, setBooks] = useState([]);
  const [selectedBookId, setSelectedBookId] = useState(null);
  const [words, setWords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);

  const currentBook = books.find((book) => Number(book.id) === Number(selectedBookId));

  async function refreshBooks(preferredId) {
    const data = await jsonFetch("/api/books");
    setBooks(data.books);
    const saved = Number(window.localStorage.getItem("en-word-book-id"));
    const nextId = preferredId || selectedBookId || saved || data.books[0]?.id || null;
    const exists = data.books.some((book) => Number(book.id) === Number(nextId));
    setSelectedBookId(exists ? Number(nextId) : Number(data.books[0]?.id || 1));
  }

  async function refreshAll() {
    if (!selectedBookId) return;
    const [wordsData, summaryData, settingsData] = await Promise.all([
      jsonFetch(`/api/words?bookId=${selectedBookId}`),
      jsonFetch(`/api/summary?bookId=${selectedBookId}`),
      jsonFetch(`/api/settings?bookId=${selectedBookId}`)
    ]);
    setWords(wordsData.words);
    setSummary(summaryData);
    setSettings(settingsData.settings);
    await refreshBooks(selectedBookId);
  }

  useEffect(() => {
    refreshBooks();
  }, []);

  useEffect(() => {
    if (!selectedBookId) return;
    window.localStorage.setItem("en-word-book-id", String(selectedBookId));
    refreshAll();
  }, [selectedBookId]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">EN-WORD</div>
          <p>按单词本管理的商务和项目管理英语拼写练习</p>
        </div>
        <nav>
          {tabs.map((tab) => (
            <button className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <BookSwitcher
        books={books}
        selectedBookId={selectedBookId}
        setSelectedBookId={setSelectedBookId}
        refreshBooks={refreshBooks}
      />

      {activeTab === "study" && <StudyPanel bookId={selectedBookId} refreshAll={refreshAll} />}
      {activeTab === "import" && <ImportPanel bookId={selectedBookId} currentBook={currentBook} refreshAll={refreshAll} />}
      {activeTab === "words" && <WordsPanel words={words} currentBook={currentBook} refreshAll={refreshAll} />}
      {activeTab === "stats" && <StatsPanel summary={summary} currentBook={currentBook} />}
      {activeTab === "settings" && <SettingsPanel bookId={selectedBookId} currentBook={currentBook} settings={settings} refreshAll={refreshAll} />}
    </main>
  );
}
