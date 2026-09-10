"use client";

import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { chain, explorerTxUrl } from "@/lib/chain";
import { CONTRIBUTION_DOMAIN, RATING_TYPES } from "@/lib/contribution";
import { encodeRatingPayload, type Toilet } from "@/lib/payload";
import type { ToiletRecord } from "@/lib/subgraph";
import { ConnectButton } from "./ConnectButton";

const AMENITIES = [
  ["hasPaper", "Paper"],
  ["hasBidet", "Bidet"],
  ["isStaffed", "Staffed"],
  ["isAccessible", "Step-free"],
  ["hasChangingTable", "Changing table"],
  ["hasMusic", "Music"],
] as const;

const SCALES = [
  ["cleanliness", "Cleanliness", ["grim", "poor", "fine", "good", "immaculate"]],
  ["smell", "Smell", ["awful", "bad", "tolerable", "fine", "fresh"]],
  ["busyness", "Busyness", ["empty", "quiet", "steady", "busy", "queue"]],
] as const;

type Draft = Partial<Toilet> & { note?: string };

/**
 * The other half of the loop: filling in what an agent could never know.
 *
 * It opens showing only the fields nobody has answered, because that is what the card was
 * asking for and a form of eleven questions when two are missing is a form nobody
 * finishes. Everything else is one tap away for anyone correcting a stale answer.
 */
export function AddWhatYouKnow({
  toilet,
  onDone,
}: {
  toilet: ToiletRecord;
  onDone: () => void;
}) {
  const { address, isConnected, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [draft, setDraft] = useState<Draft>({});
  const [showAll, setShowAll] = useState(false);
  const [status, setStatus] = useState<
    { state: "idle" } | { state: "working"; message: string } | { state: "error"; message: string }
  >({ state: "idle" });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const currentScale = (key: string) =>
    key === "cleanliness"
      ? toilet.avgCleanliness
      : key === "smell"
        ? toilet.avgSmell
        : toilet.avgBusyness;

  const missingAmenities = AMENITIES.filter(([key]) => toilet[key] === "UNKNOWN");
  const missingScales = SCALES.filter(([key]) => !currentScale(key));

  const amenities = showAll ? AMENITIES : missingAmenities;
  const scales = showAll ? SCALES : missingScales;
  const hiddenCount =
    AMENITIES.length - missingAmenities.length + (SCALES.length - missingScales.length);

  const filled = Object.values(draft).some((value) => value !== undefined && value !== "");
  const working = status.state === "working";

  async function submit() {
    if (!address || !filled) return;
    try {
      const payload = encodeRatingPayload(draft);
      const signedAt = Math.floor(Date.now() / 1000);

      setStatus({ state: "working", message: "Waiting for your signature…" });
      const signature = await signTypedDataAsync({
        domain: CONTRIBUTION_DOMAIN,
        types: RATING_TYPES,
        primaryType: "Rating",
        message: {
          rater: address,
          toiletId: BigInt(toilet.id),
          payload,
          signedAt: BigInt(signedAt),
        },
      });

      setStatus({ state: "working", message: "Writing it onchain…" });
      const response = await fetch("/api/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rater: address,
          toiletId: toilet.id,
          observations: draft,
          signedAt,
          signature,
        }),
      });
      const body = (await response.json()) as { hash?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed");

      onDone();
      // The subgraph needs a moment; a reload is the honest way to show the new state.
      setTimeout(() => window.location.reload(), 2500);
      setStatus({
        state: "working",
        message: `Thanks — indexing now. ${explorerTxUrl(body.hash!)}`,
      });
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message.split("\n")[0] : "Something went wrong",
      });
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">What do you know?</h3>
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-zinc-500 hover:underline"
        >
          cancel
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {scales.map(([key, label, words]) => (
          <div key={key}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs text-zinc-500">{label}</span>
              {!showAll || !currentScale(key) ? null : (
                <span className="text-[11px] text-zinc-400">
                  now {currentScale(key).toFixed(1)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set(key, draft[key] === value ? 0 : value)}
                  aria-label={`${label} ${value} of 5`}
                  className="rounded p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <svg
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    className={`size-5 ${
                      (draft[key] ?? 0) >= value ? "fill-amber-400" : "fill-zinc-200 dark:fill-zinc-700"
                    }`}
                  >
                    <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9z" />
                  </svg>
                </button>
              ))}
              <span className="ml-1.5 text-[11px] text-zinc-500">
                {draft[key] ? words[draft[key]! - 1] : ""}
              </span>
            </div>
          </div>
        ))}

        {amenities.map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {label}
              {showAll && toilet[key] !== "UNKNOWN" ? (
                <span className="ml-1.5 text-[11px] text-zinc-400">
                  now {toilet[key] === "YES" ? "yes" : "no"}
                </span>
              ) : null}
            </span>
            <div className="flex gap-1.5">
              <YesNo active={draft[key] === true} tone="yes" onClick={() => set(key, draft[key] === true ? undefined : true)}>
                yes
              </YesNo>
              <YesNo active={draft[key] === false} tone="no" onClick={() => set(key, draft[key] === false ? undefined : false)}>
                no
              </YesNo>
            </div>
          </div>
        ))}

        {scales.length === 0 && amenities.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Everything here has an answer already.{" "}
            <button type="button" onClick={() => setShowAll(true)} className="underline">
              Correct something
            </button>
            ?
          </p>
        ) : null}

        <input
          type="text"
          value={draft.note ?? ""}
          onChange={(event) => set("note", event.target.value)}
          placeholder="Anything else? Broken lock, great tiling…"
          className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-300"
        />
      </div>

      {!showAll && hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs text-zinc-500 hover:underline"
        >
          {hiddenCount} already answered — change one?
        </button>
      ) : null}

      <div className="mt-3">
        {!isConnected || chainId !== chain.id ? (
          <div className="text-center">
            <p className="mb-2 text-xs text-zinc-500">
              Connect a wallet so this counts as yours.
            </p>
            <ConnectButton />
          </div>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={working || !filled}
            className="w-full rounded-full bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            {working ? status.message.slice(0, 40) : filled ? "Sign and add it" : "Fill in something first"}
          </button>
        )}
        <p className="mt-2 text-center text-[11px] text-zinc-500">
          Signing is free — we pay the gas. Earns 1 weight.
        </p>
      </div>

      {status.state === "error" ? (
        <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

function YesNo({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "yes" | "no";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeClass =
    tone === "yes"
      ? "bg-emerald-600 text-white"
      : "bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`w-11 rounded-full px-2 py-1 text-xs font-medium ${
        active
          ? activeClass
          : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}
