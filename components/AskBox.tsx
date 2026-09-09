"use client";

import { useState } from "react";
import type { ToiletRecord } from "@/lib/subgraph";

type Answer = {
  answer: string;
  toilets: ToiletRecord[];
  queries: { tool: string; input: unknown }[];
};

const EXAMPLES = [
  "Free toilet with a changing table near me",
  "Somewhere step-free within ten minutes",
  "Cheapest toilet I can actually get into right now",
];

/**
 * The model knows nothing about toilets. Every fact in an answer came out of the subgraph
 * during that answer, and the queries it ran are shown underneath — partly because it's
 * honest, and partly because watching an agent query live chain data is the whole demo.
 */
export function AskBox({
  origin,
  onResults,
}: {
  origin: { lat: number; lng: number };
  onResults: (toilets: ToiletRecord[]) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [showQueries, setShowQueries] = useState(false);

  async function ask(text: string) {
    if (!text.trim() || asking) return;
    setAsking(true);
    setError(null);
    setAnswer(null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, ...origin }),
      });
      const body = (await response.json()) as Answer & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The finder failed");

      setAnswer(body);
      onResults(body.toilets);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-xl bg-white/95 p-3 shadow-2xl ring-1 ring-black/5 backdrop-blur dark:bg-zinc-900/95 dark:ring-white/10">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask for a toilet…"
          aria-label="Ask for a toilet"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-300"
        />
        <button
          type="submit"
          disabled={asking || !question.trim()}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
        >
          {asking ? "…" : "Ask"}
        </button>
      </form>

      {!answer && !error && !asking ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(example);
                  void ask(example);
                }}
                className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="mt-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {answer ? (
        <div className="mt-2">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{answer.answer}</p>
          {answer.queries.length ? (
            <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setShowQueries((open) => !open)}
                className="text-xs text-zinc-500 underline underline-offset-2"
              >
                {answer.queries.length} live subgraph{" "}
                {answer.queries.length === 1 ? "query" : "queries"}{" "}
                {showQueries ? "▾" : "▸"}
              </button>
              {showQueries ? (
                <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-zinc-100 p-2 text-[11px] leading-snug dark:bg-zinc-800">
                  {answer.queries
                    .map((q) => `${q.tool}(${JSON.stringify(q.input)})`)
                    .join("\n")}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
