import Link from "next/link";
import { HandCoins, HelpCircle, Plus, Toilet, Trophy } from "lucide-react";
import { ConnectButton } from "@/components/ConnectButton";
import { ToiletMap } from "@/components/ToiletMap";
import { withOpenState } from "@/lib/hours";
import { fetchToilets, subgraphConfigured } from "@/lib/subgraph";

// The chain moves; never serve a stale map.
export const dynamic = "force-dynamic";

const LONDON: [number, number] = [-0.1276, 51.5072];

export default async function HomePage() {
  const toilets = await fetchToilets();
  // Opening hours are parsed here so the browser never loads the parser.
  const withHours = withOpenState(toilets);

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold tracking-tight">World Wide WC</h1>
        <p className="hidden text-sm text-zinc-500 sm:block">Mapping the world wide WC.</p>

        <p className="ml-auto flex items-center gap-1.5 text-sm tabular-nums text-zinc-500">
          <Toilet className="size-4" aria-hidden />
          {toilets.length}
        </p>

        <nav className="flex items-center gap-3">
          <NavLink href="/leaderboard" icon={<Trophy className="size-4" aria-hidden />}>
            Leaderboard
          </NavLink>
          <NavLink href="/how-it-works" icon={<HelpCircle className="size-4" aria-hidden />}>
            How it works
          </NavLink>
          <NavLink href="/rewards" icon={<HandCoins className="size-4" aria-hidden />}>
            Donate
          </NavLink>
        </nav>

        <Link
          href="/submit"
          className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          <Plus className="size-4" aria-hidden />
          Add a toilet
        </Link>
        <ConnectButton />
      </header>

      <div className="min-h-0 flex-1">
        <ToiletMap toilets={withHours} center={LONDON} isPreview={!subgraphConfigured} />
      </div>
    </main>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Link>
  );
}
