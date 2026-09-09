"use client";

import { formatAccess } from "@/lib/payload";
import type { ToiletRecord } from "@/lib/subgraph";
import { explorerTxUrl } from "@/lib/chain";

const ratingWords = ["", "grim", "poor", "fine", "good", "immaculate"];

export function ToiletCard({
  toilet,
  onClose,
}: {
  toilet: ToiletRecord;
  onClose: () => void;
}) {
  const facts = [
    toilet.hasPaper ? "paper" : null,
    toilet.hasBidet ? "bidet" : null,
    toilet.isStaffed ? "staffed" : null,
    toilet.isAccessible ? "step-free" : null,
    toilet.hasChangingTable ? "changing table" : null,
    toilet.hasMusic ? "music" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-xl bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{toilet.name || "Unnamed toilet"}</h2>
          {toilet.building ? (
            <p className="mt-0.5 text-sm text-zinc-500">{toilet.building}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-1 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
        >
          ✕
        </button>
      </div>

      {toilet.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- contributor photos, arbitrary hosts
        <img
          src={toilet.photoUrl}
          alt={`Inside ${toilet.name || "this toilet"}`}
          className="mt-3 aspect-video w-full rounded-lg object-cover"
        />
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-zinc-500">Entry</dt>
          <dd className="font-medium">{formatAccess(toilet)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Cleanliness</dt>
          <dd className="font-medium">
            {toilet.avgCleanliness > 0 ? (
              <>
                {toilet.avgCleanliness.toFixed(1)}/5{" "}
                <span className="font-normal text-zinc-500">
                  {ratingWords[Math.round(toilet.avgCleanliness)]}
                </span>
              </>
            ) : (
              <span className="font-normal text-zinc-500">nobody has said</span>
            )}
          </dd>
        </div>
        {toilet.openingHours ? (
          <div className="col-span-2">
            <dt className="text-xs text-zinc-500">Open</dt>
            <dd className="font-medium">{toilet.openingHours}</dd>
          </div>
        ) : null}
      </dl>

      {facts.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {facts.map((fact) => (
            <li
              key={fact}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {fact}
            </li>
          ))}
        </ul>
      ) : null}

      {toilet.style ? <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{toilet.style}</p> : null}

      <footer className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
        <span
          className={
            toilet.source === "agent"
              ? "rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300"
              : "rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          }
        >
          {toilet.source === "agent" ? "agent-sourced" : "human-logged"}
        </span>
        {toilet.sourceUrl ? (
          <a
            href={toilet.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            source
          </a>
        ) : null}
        {toilet.txHash ? (
          <a
            href={explorerTxUrl(toilet.txHash)}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            onchain
          </a>
        ) : null}
      </footer>
    </div>
  );
}
