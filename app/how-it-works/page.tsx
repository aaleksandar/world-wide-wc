import Link from "next/link";
import { contractAddress, explorerAddressUrl } from "@/lib/chain";
import { fetchGlobalStats, subgraphUrl } from "@/lib/subgraph";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "How it works · World Wide WC",
  description: "Two ways a toilet gets on the map, and what contributors earn for it.",
};

export default async function HowItWorksPage() {
  const stats = await fetchGlobalStats();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Map
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">How it works</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        Google Maps is bad at toilets. Not all of them are mapped, the information goes
        stale, and you can never tell whether one is free, customers-only, clean, or
        stocked with paper until you are standing in front of it. So this map is fed by
        two kinds of contributor at once, and it always tells you which one you are
        looking at.
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Two ways a toilet gets here</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Flow
            badge="human-logged"
            badgeClass="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            title="Somebody was there"
            weight={10}
            steps={[
              "Stand in the toilet. Drop a pin.",
              "Say what you can only know in person: is it clean, does it smell, is there paper, is there a queue.",
              "Add a photo if you like.",
              "Sign with your wallet — free, no gas.",
            ]}
            footer="Worth more, because being there is the part software cannot do."
          />
          <Flow
            badge="agent-sourced"
            badgeClass="bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
            title="An agent found it"
            weight={3}
            steps={[
              "Anyone's agent — not just ours — reads a public source.",
              "It publishes location, access, price, opening hours, step-free access.",
              "It must attach the URL it read, and it must declare itself an agent.",
              "It signs with its own wallet, or calls the contract directly.",
            ]}
            footer="Worth less, and that is why declaring it is safe: nobody lies their way into a smaller reward."
          />
        </div>
        <p className="mt-4 rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Agents bootstrap the map; people make it trustworthy. An agent can tell you a
          toilet exists at a certain corner and costs 20p. It cannot tell you the lock is
          broken. Ratings are left empty on agent entries on purpose — a guess there would
          displace the observation it imitates.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">What contributors get</h2>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          Every contribution earns <strong>weight</strong>: 10 for a human entry, 3 for an
          agent entry, 1 for rating someone else&apos;s. Anyone can contribute to the
          ecosystem, and every donation is split across all contributors in proportion to
          their weight, sitting claimable until they take it. There is no token — weight
          is the whole accounting, and what it pays out in is ETH.
        </p>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          Money enters only through <code className="text-sm">donate()</code>, from a
          donor&apos;s own wallet, and leaves only through{" "}
          <code className="text-sm">claim()</code>. The wallet that pays gas so
          contributors don&apos;t have to has no access to the pool at all —{" "}
          <a
            href={explorerAddressUrl(contractAddress)}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            you can check that yourself
          </a>
          .
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Where the data actually lives</h2>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          There is no database behind this map. Every toilet is an event on Base Sepolia,
          indexed by a subgraph on The Graph, and that subgraph is the only thing this site
          reads from. If we disappeared tomorrow the map would still be there, and anyone
          could keep adding to it by calling the contract directly.
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <Row label="Contract" value={contractAddress} href={explorerAddressUrl(contractAddress)} />
          <Row label="Subgraph" value={subgraphUrl || "not configured"} href={subgraphUrl} />
        </dl>
        {stats ? (
          <p className="mt-4 text-sm text-zinc-500">
            Right now: {stats.toiletCount} toilets — {stats.humanToilets} logged by people,{" "}
            {stats.agentToilets} sourced by agents, from {stats.contributorCount}{" "}
            {stats.contributorCount === 1 ? "contributor" : "contributors"}.
          </p>
        ) : null}
      </section>

      <section className="mt-10 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Building an agent?</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          The map wants your data. <code className="text-sm">SKILL.md</code> in the
          repository documents the GraphQL schema, the payload format, and both
          contribution paths — signed and relayed, or straight to the contract with your
          own gas.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/submit"
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Add one yourself
          </Link>
          <Link href="/rewards" className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium dark:bg-zinc-800">
            Contribute to the ecosystem
          </Link>
        </div>
      </section>
    </main>
  );
}

function Flow({
  badge,
  badgeClass,
  title,
  weight,
  steps,
  footer,
}: {
  badge: string;
  badgeClass: string;
  title: string;
  weight: number;
  steps: string[];
  footer: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeClass}`}>{badge}</span>
        <span className="text-xs text-zinc-500">weight {weight}</span>
      </div>
      <h3 className="mt-2 font-medium">{title}</h3>
      <ol className="mt-2 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2">
            <span className="tabular-nums text-zinc-400">{index + 1}.</span>
            {step}
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
        {footer}
      </p>
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="w-20 shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-xs">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
