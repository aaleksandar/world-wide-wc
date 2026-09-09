import Link from "next/link";
import { ConnectButton } from "@/components/ConnectButton";
import { ToiletMap } from "@/components/ToiletMap";
import { fetchGlobalStats, fetchToilets, subgraphConfigured } from "@/lib/subgraph";

// The chain moves; never serve a stale map.
export const dynamic = "force-dynamic";

const LONDON: [number, number] = [-0.1276, 51.5072];

export default async function HomePage() {
  const [toilets, stats] = await Promise.all([fetchToilets(), fetchGlobalStats()]);

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold tracking-tight">
          World Wide WC
        </h1>
        <p className="text-sm text-zinc-500">Mapping the world wide WC.</p>
        <p className="ml-auto text-sm tabular-nums text-zinc-500">
          {stats
            ? `${stats.toiletCount} toilets · ${stats.humanToilets} human · ${stats.agentToilets} agent`
            : `${toilets.length} toilets`}
        </p>
        <Link href="/rewards" className="text-sm text-zinc-500 hover:underline">
          The cause
        </Link>
        <Link
          href="/submit"
          className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Add a toilet
        </Link>
        <ConnectButton />
      </header>

      <div className="min-h-0 flex-1">
        <ToiletMap toilets={toilets} center={LONDON} isPreview={!subgraphConfigured} />
      </div>
    </main>
  );
}
