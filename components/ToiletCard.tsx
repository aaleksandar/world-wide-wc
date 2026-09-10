"use client";

import { explorerTxUrl } from "@/lib/chain";
import { ipfsToHttp } from "@/lib/ipfs";
import { formatAccess } from "@/lib/payload";
import type { Known, ToiletRecord } from "@/lib/subgraph";
import { Stars } from "./Stars";

const SCALE_WORDS: Record<string, [string, string, string, string, string]> = {
  cleanliness: ["grim", "poor", "fine", "good", "immaculate"],
  smell: ["awful", "bad", "tolerable", "fine", "fresh"],
  busyness: ["empty", "quiet", "steady", "busy", "queue"],
};

/**
 * Every criterion appears whether or not anyone has filled it in, because the gaps are
 * the point: a map that hides what it doesn't know looks finished and lies.
 *
 * Amenities are tri-state and each state gets its own tag. "No bidet" is a fact somebody
 * established and worth as much as "has paper"; "not recorded" is the absence of a fact
 * and reads as an invitation rather than an answer.
 */
export function ToiletCard({ toilet, onClose }: { toilet: ToiletRecord; onClose: () => void }) {
  const amenities: [string, string, Known][] = [
    ["paper", "no paper", toilet.hasPaper],
    ["bidet", "no bidet", toilet.hasBidet],
    ["staffed", "unstaffed", toilet.isStaffed],
    ["step-free", "not step-free", toilet.isAccessible],
    ["changing table", "no changing table", toilet.hasChangingTable],
    ["music", "no music", toilet.hasMusic],
  ];

  const scales: [string, string, number][] = [
    ["Cleanliness", "cleanliness", toilet.avgCleanliness || toilet.cleanliness],
    ["Smell", "smell", toilet.smell],
    ["Busyness", "busyness", toilet.busyness],
  ];

  const unknownAmenities = amenities.filter(([, , state]) => state === "UNKNOWN");
  const unratedScales = scales.filter(([, , value]) => !value);
  const missing = unknownAmenities.length + unratedScales.length;

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

      <dl className="mt-3.5 space-y-0.5">
        <Row label="Entry">
          <strong className="font-medium">{formatAccess(toilet)}</strong>
        </Row>
        <Row label="Open" empty={!toilet.openingHours} missing="not recorded">
          {toilet.openingHours}
        </Row>

        {scales.map(([label, key, value]) => (
          <Row key={label} label={label}>
            <Stars
              value={value}
              label={
                value
                  ? SCALE_WORDS[key][Math.min(4, Math.max(0, Math.round(value) - 1))]
                  : "not rated"
              }
            />
          </Row>
        ))}

        <Row label="Character" empty={!toilet.style} missing="not recorded">
          {toilet.style}
        </Row>
      </dl>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {amenities.map(([yes, no, state]) => (
          <li key={yes}>
            <Tag state={state}>{state === "NO" ? no : yes}</Tag>
          </li>
        ))}
      </ul>

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
          <a href={toilet.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200">
            source
          </a>
        ) : null}
        {toilet.txHash ? (
          <a href={explorerTxUrl(toilet.txHash)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200">
            onchain
          </a>
        ) : null}
      </footer>
    </div>
  );
}

/** Solid for a confirmed yes, struck through for a confirmed no, dashed for unrecorded. */
function Tag({ state, children }: { state: Known; children: React.ReactNode }) {
  if (state === "YES") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        {children}
      </span>
    );
  }
  if (state === "NO") {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 line-through decoration-zinc-400 dark:bg-zinc-800 dark:text-zinc-400">
        {children}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-400 dark:border-zinc-600 dark:text-zinc-500">
      {children}?
    </span>
  );
}

function Row({
  label,
  children,
  empty,
  missing,
}: {
  label: string;
  children?: React.ReactNode;
  empty?: boolean;
  missing?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-100 py-1.5 last:border-0 dark:border-zinc-800/60">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className={empty ? "text-right text-sm text-zinc-400 italic" : "text-right text-sm"}>
        {empty ? (missing ?? "—") : children}
      </dd>
    </div>
  );
}
