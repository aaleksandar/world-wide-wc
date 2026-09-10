"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { PinMap } from "@/components/PinMap";
import { chain, explorerTxUrl, toChainCoord } from "@/lib/chain";
import { CONTRIBUTION_DOMAIN, CONTRIBUTION_TYPES } from "@/lib/contribution";
import { ACCESS, type Access, type Toilet, encodePayload } from "@/lib/payload";

const LONDON = { lat: 51.5072, lng: -0.1276 };

const ACCESS_LABELS: Record<Access, string> = {
  free: "Free",
  paid: "Paid",
  customer: "Customers only",
  unknown: "Not sure",
};

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

type Status =
  | { state: "idle" }
  | { state: "working"; message: string }
  | { state: "done"; hash: string }
  | { state: "error"; message: string };

export default function SubmitPage() {
  const { address, isConnected, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [position, setPosition] = useState(LONDON);
  const [draft, setDraft] = useState<Partial<Toilet>>({ access: "unknown", currency: "GBP" });
  const [photo, setPhoto] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const set = <K extends keyof Toilet>(key: K, value: Toilet[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const working = status.state === "working";

  async function submit() {
    if (!address) return;
    try {
      let photoUrl = draft.photoUrl ?? "";
      if (photo) {
        setStatus({ state: "working", message: "Uploading photo…" });
        const form = new FormData();
        form.set("photo", photo);
        const response = await fetch("/api/photo", { method: "POST", body: form });
        const body = (await response.json()) as { url?: string; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Photo upload failed");
        photoUrl = body.url ?? "";
      }

      const toilet: Partial<Toilet> = { ...draft, photoUrl, source: "human" };
      const payload = encodePayload(toilet);
      const signedAt = Math.floor(Date.now() / 1000);

      setStatus({ state: "working", message: "Waiting for your signature…" });
      const signature = await signTypedDataAsync({
        domain: CONTRIBUTION_DOMAIN,
        types: CONTRIBUTION_TYPES,
        primaryType: "Contribution",
        message: {
          contributor: address,
          lat: toChainCoord(position.lat),
          lng: toChainCoord(position.lng),
          payload,
          signedAt: BigInt(signedAt),
        },
      });

      setStatus({ state: "working", message: "Writing it onchain…" });
      const response = await fetch("/api/contribute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contributor: address,
          lat: position.lat,
          lng: position.lng,
          toilet,
          signedAt,
          signature,
        }),
      });
      const body = (await response.json()) as { hash?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Submission failed");

      setStatus({ state: "done", hash: body.hash! });
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : "Something went wrong",
      });
    }
  }

  if (status.state === "done") {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-5xl">🚽</p>
        <h1 className="mt-4 text-2xl font-semibold">On the map, and onchain.</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          That earned you 10 weight. Every donation to the toilet cause is split by weight,
          and your share sits claimable until you take it.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/"
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
          >
            Back to the map
          </Link>
          <a
            href={explorerTxUrl(status.hash)}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium dark:bg-zinc-800"
          >
            View transaction
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← Map
          </Link>
          <h1 className="mt-1 text-xl font-semibold">Add a toilet</h1>
        </div>
        <ConnectButton />
      </header>

      <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
        Only the location matters. Everything else is optional — one honest fact beats a
        blank form.
      </p>

      <section className="mt-5">
        <PinMap position={position} onMove={setPosition} />
        <p className="mt-1.5 font-mono text-xs text-zinc-500">
          {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
        </p>
      </section>

      <div className="mt-6 space-y-5">
        <Field label="Name">
          <input
            type="text"
            placeholder="Trafalgar Square Toilets"
            value={draft.name ?? ""}
            onChange={(event) => set("name", event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Where exactly" hint="Which building, which floor, past which door">
          <input
            type="text"
            placeholder="Basement, past the lifts"
            value={draft.building ?? ""}
            onChange={(event) => set("building", event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Getting in">
          <div className="flex flex-wrap gap-2">
            {ACCESS.map((option) => (
              <Chip
                key={option}
                active={draft.access === option}
                onClick={() => set("access", option)}
              >
                {ACCESS_LABELS[option]}
              </Chip>
            ))}
          </div>
          {draft.access === "paid" ? (
            <input
              type="number"
              inputMode="decimal"
              step="0.05"
              min="0"
              placeholder="0.50"
              onChange={(event) =>
                set("price", Math.round(Number(event.target.value || 0) * 100))
              }
              className={`${inputClass} mt-2`}
            />
          ) : null}
        </Field>

        {SCALES.map(([key, label, words]) => (
          <Field key={key} label={label}>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set(key, draft[key] === value ? 0 : value)}
                  aria-label={`${label} ${value} of 5`}
                  aria-pressed={draft[key] === value}
                  className="rounded p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <svg
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    className={`size-7 ${
                      (draft[key] ?? 0) >= value
                        ? "fill-amber-400"
                        : "fill-zinc-200 dark:fill-zinc-700"
                    }`}
                  >
                    <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9z" />
                  </svg>
                </button>
              ))}
              <span className="ml-2 text-xs text-zinc-500">
                {draft[key] ? words[draft[key]! - 1] : "tap to rate"}
              </span>
            </div>
          </Field>
        ))}

        <Field
          label="What's in there"
          hint="Leave blank if you didn't look — that's different from no"
        >
          <div className="space-y-1.5">
            {AMENITIES.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="text-sm">{label}</span>
                <div className="flex gap-1.5">
                  <YesNo
                    active={draft[key] === true}
                    tone="yes"
                    onClick={() => set(key, draft[key] === true ? undefined : true)}
                  >
                    yes
                  </YesNo>
                  <YesNo
                    active={draft[key] === false}
                    tone="no"
                    onClick={() => set(key, draft[key] === false ? undefined : false)}
                  >
                    no
                  </YesNo>
                </div>
              </div>
            ))}
          </div>
        </Field>

        <Field label="Anything worth saying" hint="Art deco tiling. Plays jazz. Chandelier.">
          <input
            type="text"
            value={draft.style ?? ""}
            onChange={(event) => set("style", event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Photo" hint="Optional. Goes to IPFS, so it can't be swapped later">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm dark:text-zinc-400 dark:file:bg-zinc-800"
          />
        </Field>
      </div>

      <div className="mt-8 border-t border-zinc-200 pt-5 dark:border-zinc-800">
        {!isConnected ? (
          <div className="text-center">
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              Connect a wallet so the entry — and the rewards — are yours.
            </p>
            <ConnectButton />
          </div>
        ) : chainId !== chain.id ? (
          <div className="text-center">
            <ConnectButton />
          </div>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={working}
            className="w-full rounded-full bg-zinc-900 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {working ? status.message : "Sign and add it"}
          </button>
        )}

        <p className="mt-3 text-center text-xs text-zinc-500">
          Signing is free. We pay the gas.
        </p>

        {status.state === "error" ? (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {status.message}
          </p>
        ) : null}
      </div>
    </main>
  );
}

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-300";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="ml-2 text-xs text-zinc-500">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Three states, not two: yes, no, and left alone. Tapping the active one clears it back to
 * unrecorded, so a mis-tap is recoverable and "I didn't check" stays sayable.
 */
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
      className={`w-12 rounded-full px-2.5 py-1 text-xs font-medium ${
        active
          ? activeClass
          : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
          : "rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      }
    >
      {children}
    </button>
  );
}
