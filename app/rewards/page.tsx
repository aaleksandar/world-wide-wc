"use client";

import Link from "next/link";
import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { chain, contractAddress, explorerAddressUrl, explorerTxUrl } from "@/lib/chain";
import { wwwcAbi } from "@/lib/wwwc-abi";

/**
 * The toilet cause.
 *
 * Donations come from donors' own wallets straight into the contract, and leave only
 * through claim(). Nothing we run can touch the pool in between — the relayer that pays
 * gas for contributions has no access to it at all.
 */
export default function RewardsPage() {
  const { address, isConnected, chainId } = useAccount();
  const [amount, setAmount] = useState("0.01");
  const [note, setNote] = useState("");

  const contract = { address: contractAddress, abi: wwwcAbi } as const;
  const onRightChain = isConnected && chainId === chain.id;

  const totalDonated = useReadContract({ ...contract, functionName: "totalDonated" });
  const totalWeight = useReadContract({ ...contract, functionName: "totalWeight" });
  const poolPending = useReadContract({ ...contract, functionName: "poolPending" });

  const enabled = { query: { enabled: !!address } };
  const pending = useReadContract({
    ...contract, functionName: "pendingOf", args: address ? [address] : undefined, ...enabled,
  });
  const weight = useReadContract({
    ...contract, functionName: "weightOf", args: address ? [address] : undefined, ...enabled,
  });
  const claimed = useReadContract({
    ...contract, functionName: "claimedOf", args: address ? [address] : undefined, ...enabled,
  });

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  const refresh = () => {
    for (const read of [totalDonated, totalWeight, poolPending, pending, weight, claimed]) {
      void read.refetch();
    }
  };

  if (receipt.isSuccess && !receipt.isFetching) {
    // Cheap and good enough: the reads are all against one contract.
    setTimeout(refresh, 0);
  }

  const donate = () => {
    let value: bigint;
    try {
      value = parseEther(amount || "0");
    } catch {
      return;
    }
    if (value <= 0n) return;
    writeContract({ ...contract, functionName: "donate", args: [note], value });
  };

  const claimable = (pending.data as bigint | undefined) ?? 0n;
  const myWeight = (weight.data as bigint | undefined) ?? 0n;
  const allWeight = (totalWeight.data as bigint | undefined) ?? 0n;
  const sharePercent = allWeight > 0n ? (Number(myWeight) / Number(allWeight)) * 100 : 0;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← Map
          </Link>
          <h1 className="mt-1 text-xl font-semibold">The toilet cause</h1>
        </div>
        <ConnectButton />
      </header>

      <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
        Anyone can donate. Every donation is split across everyone who has mapped a toilet,
        in proportion to what they contributed, and stays claimable until they take it.{" "}
        <a
          href={explorerAddressUrl(contractAddress)}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          The pool is onchain
        </a>{" "}
        — we can&apos;t touch it.
      </p>

      <section className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Donated" value={`${formatEther((totalDonated.data as bigint) ?? 0n)} ETH`} />
        <Stat label="Total weight" value={String(allWeight)} />
        <Stat
          label="Undistributed"
          value={`${formatEther((poolPending.data as bigint) ?? 0n)} ETH`}
          hint="Waiting for enough weight to divide into"
        />
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">Donate</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="number"
            step="0.001"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-label="Amount in ETH"
            className="w-28 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
          <span className="self-center text-sm text-zinc-500">ETH</span>
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="For the mappers of London (optional)"
            className="min-w-40 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
        </div>
        <button
          type="button"
          disabled={!onRightChain || isPending}
          onClick={donate}
          className="mt-3 w-full rounded-full bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {isPending ? "Confirm in your wallet…" : "Donate"}
        </button>
        {!onRightChain ? (
          <p className="mt-2 text-center text-xs text-zinc-500">
            Connect a wallet on {chain.name} to donate.
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">Your share</h2>
        {!isConnected ? (
          <p className="mt-2 text-sm text-zinc-500">Connect a wallet to see what you&apos;ve earned.</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Stat label="Claimable" value={`${formatEther(claimable)} ETH`} />
              <Stat
                label="Your weight"
                value={`${myWeight} · ${sharePercent.toFixed(1)}%`}
                hint="Your share of every future donation"
              />
              <Stat label="Claimed so far" value={`${formatEther((claimed.data as bigint) ?? 0n)} ETH`} />
            </div>
            <button
              type="button"
              disabled={!onRightChain || claimable === 0n || isPending}
              onClick={() => writeContract({ ...contract, functionName: "claim" })}
              className="mt-3 w-full rounded-full bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
            >
              {claimable > 0n ? `Claim ${formatEther(claimable)} ETH` : "Nothing to claim yet"}
            </button>
          </>
        )}
      </section>

      {error ? (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error.message.split("\n")[0]}
          <button type="button" onClick={() => reset()} className="ml-2 underline">
            dismiss
          </button>
        </p>
      ) : null}

      {hash ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          {receipt.isSuccess ? "Done — " : "Waiting for confirmation — "}
          <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer" className="underline">
            view transaction
          </a>
        </p>
      ) : null}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
      <dt className="text-xs text-zinc-500" title={hint}>
        {label}
      </dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  );
}
