import Link from "next/link";
import { formatEther } from "viem";
import { explorerAddressUrl } from "@/lib/chain";
import { fetchLeaderboard } from "@/lib/subgraph";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leaderboard · World Wide WC",
  description: "Who has mapped the most toilets, and what they've earned for it.",
};

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Enough precision to see a small share without a wall of zeroes. */
function eth(wei: bigint): string {
  if (wei === 0n) return "0";
  const value = Number(formatEther(wei));
  if (value < 0.000001) return "<0.000001";
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export default async function LeaderboardPage() {
  const { contributors, stats } = await fetchLeaderboard();
  const totalWeight = stats ? BigInt(stats.totalWeight) : 0n;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Map
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Leaderboard</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Everyone who has put a toilet on this map, and what the toilet cause has paid them
        for it. Read straight from the subgraph — nothing here is a database row.
      </p>

      {stats ? (
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Contributors" value={String(stats.contributorCount)} />
          <Stat label="Toilets" value={String(stats.toiletCount)} />
          <Stat label="Donated" value={`${eth(BigInt(stats.totalDonated))} ETH`} />
          <Stat label="Claimed" value={`${eth(BigInt(stats.totalClaimed))} ETH`} />
        </dl>
      ) : null}

      {contributors.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
          Nobody has contributed yet.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Contributor</th>
                <th className="py-2 pr-3 text-right font-medium">Toilets</th>
                <th className="py-2 pr-3 text-right font-medium">Ratings</th>
                <th className="py-2 pr-3 text-right font-medium">Weight</th>
                <th className="py-2 pr-3 text-right font-medium">Earned</th>
                <th className="py-2 text-right font-medium">Unclaimed</th>
              </tr>
            </thead>
            <tbody>
              {contributors.map((contributor, index) => {
                const share =
                  totalWeight > 0n ? (Number(contributor.weight) / Number(totalWeight)) * 100 : 0;
                return (
                  <tr
                    key={contributor.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                  >
                    <td className="py-2.5 pr-3 tabular-nums text-zinc-400">{index + 1}</td>
                    <td className="py-2.5 pr-3">
                      <a
                        href={explorerAddressUrl(contributor.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs underline-offset-2 hover:underline"
                      >
                        {short(contributor.id)}
                      </a>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {contributor.toiletsLogged}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-500">
                      {contributor.ratingsGiven}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {String(contributor.weight)}
                      <span className="ml-1.5 text-xs text-zinc-400">
                        {share.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">
                      {eth(contributor.earned)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-zinc-500">
                      {contributor.pending > 0n ? eth(contributor.pending) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-500">
        Earned is everything the pool has ever owed them — claimed plus unclaimed — in ETH.
        Weight is 10 per toilet a person logged, 3 per agent-sourced one, 1 per rating.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/submit"
          className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Add a toilet
        </Link>
        <Link
          href="/rewards"
          className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium dark:bg-zinc-800"
        >
          Donate to the cause
        </Link>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  );
}
