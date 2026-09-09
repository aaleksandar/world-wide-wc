"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "@/lib/chain";

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const injectedConnector = connectors.find((c) => c.id === "injected") ?? connectors[0];

  if (!isConnected) {
    return (
      <button
        type="button"
        disabled={isPending || !injectedConnector}
        onClick={() => injectedConnector && connect({ connector: injectedConnector })}
        className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (chainId !== chain.id) {
    return (
      <button
        type="button"
        onClick={() => switchChain({ chainId: chain.id })}
        className="rounded-full bg-amber-500 px-4 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-400"
      >
        Switch to {chain.name}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => disconnect()}
      title="Disconnect"
      className="rounded-full bg-zinc-100 px-4 py-1.5 font-mono text-sm text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
    >
      {short(address!)}
    </button>
  );
}
