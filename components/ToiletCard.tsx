"use client";

import { explorerTxUrl } from "@/lib/chain";
import { ipfsToHttp } from "@/lib/ipfs";
import { formatAccess } from "@/lib/payload";
import type { ToiletRecord } from "@/lib/subgraph";

const SCALE_WORDS: Record<string, [string, string, string, string, string]> = {
  cleanliness: ["grim", "poor", "fine", "good", "immaculate"],
  smell: ["awful", "bad", "tolerable", "fine", "fresh"],
  busyness: ["empty", "quiet", "steady", "busy", "queue"],
};

/**
 * Every criterion is listed whether or not anyone has filled it in, because the gaps are
 * the point: a map that hides what it doesn't know looks complete and lies. Seeing eleven
 * "not recorded" rows is what tells you this entry needs a human.
 *
 * Absent booleans read "not recorded" rather than "no". The payload encoder drops fields
 * at their default to save calldata, so `false` and "nobody said" are genuinely
 * indistinguishable onchain — claiming there is no bidet would be inventing data.
 */
export function ToiletCard({ toilet, onClose }: { toilet: ToiletRecord; onClose: () => void }) {
  const amenities = [
    ["Paper", toilet.hasPaper],
    ["Bidet", toilet.hasBidet],
    ["Staffed", toilet.isStaffed],
    ["Step-free", toilet.isAccessible],
    ["Changing table", toilet.hasChangingTable],
    ["Music", toilet.hasMusic],
  ] as const;

  const scales = [
    ["Cleanliness", "cleanliness", toilet.avgCleanliness || toilet.cleanliness],
    ["Smell", "smell", toilet.smell],
    ["Busyness", "busyness", toilet.busyness],
  ] as const;

  const missing =
    scales.filter(([, , value]) => !value).length +
    amenities.filter(([, value]) => !value).length;

  return (
    <div className="max-h-[70vh] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
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
          src={ipfsToHttp(toilet.photoUrl)}
          alt={`Inside ${toilet.name || "this toilet"}`}
          className="mt-3 aspect-video w-full rounded-lg object-cover"
        />
      ) : null}

      <dl className="mt-4 space-y-0.5">
        <Row label="Entry" value={<strong className="font-medium">{formatAccess(toilet)}</strong>} />
        <Row
          label="Open"
          value={toilet.openingHours || null}
          missing="not recorded"
        />

        {scales.map(([label, key, value]) => (
          <Row
            key={label}
            label={label}
            value={
              value ? (
                <>
                  <strong className="font-medium">{Number(value).toFixed(1)}</strong>
                  <span className="text-zinc-400">/5</span>{" "}
                  <span className="text-zinc-500">
                    {SCALE_WORDS[key][Math.round(Number(value)) - 1]}
                  </span>
                </>
              ) : null
            }
            missing="nobody has rated it"
          />
        ))}

        {amenities.map(([label, present]) => (
          <Row
            key={label}
            label={label}
            value={present ? <span className="text-emerald-600 dark:text-emerald-400">yes</span> : null}
            missing="not recorded"
          />
        ))}

        <Row label="Character" value={toilet.style || null} missing="not recorded" />
      </dl>

      {missing > 0 ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          {missing} {missing === 1 ? "thing is" : "things are"} unrecorded here.{" "}
          {toilet.source === "agent"
            ? "An agent found this one, and no agent can tell you whether it smells."
            : "Add what you know next time you're in."}
        </p>
      ) : null}

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
        {toilet.ratingCount > 0 ? (
          <span>
            {toilet.ratingCount} {toilet.ratingCount === 1 ? "rating" : "ratings"}
          </span>
        ) : null}
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

function Row({
  label,
  value,
  missing,
}: {
  label: string;
  value: React.ReactNode | null;
  missing?: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-100 py-1.5 last:border-0 dark:border-zinc-800/60">
      <dt className={empty ? "text-sm text-zinc-400" : "text-sm text-zinc-500"}>{label}</dt>
      <dd className={empty ? "text-right text-sm text-zinc-400 italic" : "text-right text-sm"}>
        {empty ? (missing ?? "—") : value}
      </dd>
    </div>
  );
}
