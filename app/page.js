"use client";

import { useEffect, useMemo, useState } from "react";

const tabs = [
  { id: "study", label: "背诵" },
  { id: "import", label: "导入" },
  { id: "words", label: "单词池" },
  { id: "stats", label: "统计" },
  { id: "settings", label: "设置" }
];

async function jsonFetch(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function LetterBars({ word, value }) {
  const letters = Array.from(word || "");
  const typed = Array.from(value || "");
  return (
    <div className="letter-bars" aria-label="拼写反馈">
      {letters.map((letter, index) => {
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

function StudyPanel({ refreshAll }) {
  const [item, setItem] = useState(null);
  const [answer, setAnswer] = useState("");
  const [hadTypingError, setHadTypingError] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function loadNext() {
    setLoading(true);
    setAnswer("");
    setHadTypingError(false);
    setResult(null);
    try {
      const data = await jsonFetch("/api/study/next");
      setItem(data.item);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNext();
  }, []);

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
        word_id: item.word_id,
        phrase_id: item.phrase_id,
        user_answer: answer,
        had_typing_error: hadTypingError,
        was_skipped: wasSkipped
      })
    });
    setResult(data);
    refreshAll();
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
        <h2>还没有可背诵的单词</h2>
        <p>先到“导入”页粘贴英文单词，系统会补全商务和项目管理短语。</p>
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
          className="answer-input"
          value={answer}
          onChange={(event) => setAnswer(event.target.value.slice(0, item.word.length))}
          placeholder="输入英文单词"
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
            <p>本次短语来自商务和项目管理场景。输入过程中只要出现红杠，就会记录为一次拼写不稳定。</p>
          </>
        ) : (
          <>
            <div className={`result-pill ${result.is_correct ? "ok" : "bad"}`}>
              {result.is_correct ? "拼写正确" : "需要复习"}
            </div>
            <h2>
              {item.word} <span>{item.phonetic_us}</span>
            </h2>
            <p className="definition">{item.english_definition}</p>
            <dl>
              <dt>短语</dt>
              <dd>{item.phrase}</dd>
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

function ImportPanel({ refreshAll }) {
  const [text, setText] = useState("align 对齐\nprioritize 优先处理\nmitigate 缓解");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const data = await jsonFetch("/api/import", {
        method: "POST",
        body: JSON.stringify({ text })
      });
      setResult(data);
      refreshAll();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>批量导入</h2>
          <p>每行一个英文单词，中文释义可选。系统会补全商务/项目管理短语。</p>
        </div>
        <button className="primary" onClick={submit} disabled={busy}>
          {busy ? "导入中..." : "导入"}
        </button>
      </div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} />
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

function WordsPanel({ words }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return words;
    return words.filter((word) => `${word.word} ${word.user_meaning || ""} ${word.system_meaning || ""}`.toLowerCase().includes(keyword));
  }, [words, query]);

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>单词池</h2>
          <p>查看校验状态、权重、短语数量和学习统计。</p>
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
            <div>权重 {word.base_weight}</div>
            <div>短语 {word.phrase_count}</div>
            <div>
              对 {word.correct_count} / 错 {word.wrong_count}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatsPanel({ summary }) {
  const accuracy = summary?.today?.reviewed ? Math.round((summary.today.correct / summary.today.reviewed) * 100) : 0;
  return (
    <section className="panel">
      <h2>学习统计</h2>
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

function SettingsPanel({ settings, refreshAll }) {
  const [count, setCount] = useState(settings?.daily_study_count || 20);

  useEffect(() => {
    if (settings?.daily_study_count) setCount(settings.daily_study_count);
  }, [settings]);

  async function save() {
    await jsonFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ daily_study_count: Number(count) })
    });
    refreshAll();
  }

  return (
    <section className="panel settings-panel">
      <h2>每日设置</h2>
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
  const [words, setWords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);

  async function refreshAll() {
    const [wordsData, summaryData, settingsData] = await Promise.all([
      jsonFetch("/api/words"),
      jsonFetch("/api/summary"),
      jsonFetch("/api/settings")
    ]);
    setWords(wordsData.words);
    setSummary(summaryData);
    setSettings(settingsData.settings);
  }

  useEffect(() => {
    refreshAll();
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">EN-WORD</div>
          <p>商务和项目管理场景的单词拼写练习</p>
        </div>
        <nav>
          {tabs.map((tab) => (
            <button className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === "study" && <StudyPanel refreshAll={refreshAll} />}
      {activeTab === "import" && <ImportPanel refreshAll={refreshAll} />}
      {activeTab === "words" && <WordsPanel words={words} />}
      {activeTab === "stats" && <StatsPanel summary={summary} />}
      {activeTab === "settings" && <SettingsPanel settings={settings} refreshAll={refreshAll} />}
    </main>
  );
}
