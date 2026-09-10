# World Wide WC

**Mapping the world wide WC.** An onchain map of public toilets, fed by people and by
other people's AI agents, where everyone who contributes gets paid out of what anyone
donates.

Built for [ETHOnline 2026](https://ethglobal.com/events/ethonline2026).

| | |
|---|---|
| **Live** | **https://world-wide-wc.vercel.app** |
| Contract | [`0xf58e751a284068783165c9b837734a6105c27052`](https://sepolia.basescan.org/address/0xf58e751a284068783165c9b837734a6105c27052) · Base Sepolia |
| Subgraph | [`world-wide-wc/v0.0.8`](https://api.studio.thegraph.com/query/1759984/world-wide-wc/v0.0.8) · Subgraph Studio |
| Agent docs | [SKILL.md](./SKILL.md) · MCP server at `mcp/server.mts` |

## The problem

Google Maps is bad at toilets. Not all are mapped. The information goes stale. The
building usually isn't identified, so you know a toilet is *somewhere* in the station.
And you can never tell whether it's free, customers-only, clean, staffed, step-free, or
stocked with paper until you are standing in front of it.

Those last facts are the ones that matter, and they're precisely the ones no dataset has,
because knowing them requires somebody to have been there.

## The idea

Two kinds of contributor, and the map always says which one you're looking at.

**Agents bootstrap it.** Anyone's agent — not just ours — can read a public source and
publish what it found: location, access, price, opening hours, step-free access. It must
declare itself an agent and attach the URL it read.

**People make it trustworthy.** Somebody standing in the toilet can say the things
software cannot: is it clean, does it smell, is there paper, is there a queue. Any entry
on the map can be filled in by whoever visits next — the card lists what nobody has
answered and the form asks only those questions.

**Donations flow to both.** Anyone can contribute to the ecosystem. Every donation splits
across all contributors in proportion to what they contributed, claimable whenever they
want it.

## The judge

An agent can tell you a toilet exists. It cannot tell you whether the page it read is
still true. So a judge reads entries back out of the subgraph and checks the source behind
each one — does it still resolve, when was it last surveyed, does it still say what we
recorded — and writes a verdict onchain.

| Band | Meaning | Weight earned |
|---|---|---|
| `max` | fresh, resolves, corroborates the claims | **+7** |
| `medium` | real but stale, or only partly supporting | +2 |
| `low` | deleted, or contradicts the entry | +0 |

An agent entry starts at weight 3 *precisely because nobody checked it*. A proven source
lifts it to 10 — exactly what a person standing there would have earned. Weight stops
being declared and starts being earned.

The division of labour matters. `lib/evidence.ts` establishes every fact deterministically
— whether the source resolves, how many days old it is, which fields it now contradicts —
so the model is only ever asked to do the part with no formula: weighing a five-year-old
but uncontradicted source against a fresh one that disagrees on price. It is never trusted
to count days.

Two judgements it gets right that a cruder rule would not: a source untouched for 1833
days lands `medium` rather than `max` even with nothing contradicting it, and a site that
answers 403 to crawlers lands `medium` rather than `low`, because being refused tells you
nothing about the toilet.

`verify()` pays only the difference between what a score earns and what was already
granted, and never reduces — so the reward accumulator stays increase-only and nobody
loses ETH they already accrued because a judge changed its mind.

**Named tradeoff:** the judge is relayer-gated, so we decide who grants bonus weight. That
is a centralisation point. It is mitigated by putting the reasoning onchain — every verdict
is publicly auditable — and by capping the bonus at human parity, so no verdict can mint
more than an honest first-hand visit.

## An MCP server that isn't a wrapper

The Graph already ships a Subgraph MCP across 15,000+ subgraphs, so proxying GraphQL would
be worth nothing. Every tool in `mcp/server.mts` is something a subgraph query cannot
express:

- **`find_toilets`** — distance has no GraphQL operator, and nothing in GraphQL parses
  `Jan-Feb 08:00-18:00` in the toilet's own timezone.
- **`contribute_toilet`, `rate_toilet`** — writes. All nine of The Graph's MCP tools are
  read-only, and an agent that cannot contribute is useless to a map built by contributors.

There is a blunter reason too: this subgraph lives in Studio on Base Sepolia, and The
Graph's MCP needs a Gateway key against published subgraphs, so it cannot reach this data
at all.

We don't charge for it. The value is the capability, not the access.

## Why The Graph is load-bearing

There is no database in this project. Every toilet, rating, donation and claim is an
event on Base Sepolia; a subgraph indexes them; and `lib/subgraph.ts` — one file, the
app's only read path — is the only way this site gets data. Turn the subgraph off and the
map is blank.

## Provenance is an onchain fact

The contract emits `isAgent` on every entry and the subgraph reads *that*, not a field in
the JSON payload. It's the same flag that set the contributor's weight, so it's the only
version of the claim that cost anything to assert.

Provenance is self-declared, and that's safe because honesty is the cheaper option:

| | weight |
|---|---|
| A person who was there | 10 |
| An agent that read a source | 3 |
| Rating someone else's entry | 1 |

Nobody lies their way into a smaller reward. The lie worth telling is claiming to be
human when you're software — and that's the one readers can catch, because an agent entry
without a working source URL is visibly worthless.

Agent entries also leave `cleanliness`, `smell` and `busyness` unrated on purpose. A guess
there would displace the observation it imitates.

Amenities are tri-state — `YES`, `NO`, `UNKNOWN` — because "somebody checked and there is
no bidet" and "nobody has said" are different facts, and a map that conflates them looks
complete and lies. The UI shows all three: a solid tag, a struck-through tag, and a dashed
one. The OSM harvester respects it too: a missing tag becomes `UNKNOWN`, and
`wheelchair=limited` also becomes `UNKNOWN` rather than a yes, because telling a wheelchair
user they can get in when they may not is a wrong answer with real consequences.

## Finding one

The map filters on everything it records: how you get in, whether it's open right now,
cleanliness, smell, busyness, and each of the six fittings. Filtering runs in the browser
over toilets already loaded from the subgraph, so it is instant and the map never
flickers — the subgraph supports the same filters natively for anyone querying it
directly, which is what `SKILL.md` documents.

"Open now" is evaluated on the server, in the timezone of the toilet rather than of the
viewer. OSM opening hours are far messier than they look — our own London data contains
month ranges, public-holiday clauses, split intervals and `08:00-dusk` — so this uses a
real parser rather than a regex. Being wrong here sends somebody to a locked door.

A rating filter deliberately excludes unrated toilets, and says so: asking for "3 stars or
better" and being shown places nobody has rated would be the same quiet lie the tri-state
work removed elsewhere.

## Photos are content-addressed

Photos go to IPFS and only `ipfs://<cid>` goes onchain. Not on The Graph — that indexes
events, it doesn't store files — but IPFS is the same neighbourhood: it's where subgraph
manifests live and `graph-cli` ships a client for it.

It suits this project better than ordinary object storage for a reason beyond
convenience. A CID is a hash of the bytes, so the photo attached to a toilet can't be
quietly swapped for a different one later. The provenance argument that applies to the
data applies to the pictures too. Gateway URLs are never stored — those come and go; the
CID is the durable name.

The default configuration needs no account at all. Set `PINATA_JWT` for a second pin if
the photos should outlive the demo: The Graph's IPFS node is meant for subgraph manifests
and nothing promises it will keep a stranger's photo.

## Two ways to contribute, and only one of them needs us

```solidity
function log(int32 lat, int32 lng, string payload, bool isAgent) external returns (uint256);
```

**Directly.** Call the contract, pay your own gas, depend on nothing of ours. If every
server we run disappeared, the map would still be there and anyone could keep adding to
it.

**Relayed.** Sign an EIP-712 message and POST it to `/api/contribute`; we pay the gas, so
a contributor never needs to hold ETH. This is what makes "add a toilet" a thing you can
do in ten seconds instead of a thing that starts with finding a faucet.

Both paths are exercised end to end by `scripts/test-third-party-agent.mts`, using a
wallet generated on the spot to stand in for a stranger.

**Known limitation:** the relayed path verifies signatures *off-chain*, so it asks you to
trust this project's server not to invent contributions. The direct path asks you to trust
nobody. The signed struct is shaped to move on-chain as EIP-712 with a nonce, which is the
first thing to do after the hackathon.

## The reward pool

Contributing earns **weight** — 10 for a person who was there, 3 for an agent entry, 1 for
rating someone else's. Every donation is split across all contributors in proportion to
weight, and sits claimable until they take it.

There is no token. Weight is the whole accounting and payouts are in ETH. An earlier
version also minted an ERC-20 one-for-one with weight, which was a second name for the
same number — and a misleading one, since the token transferred while the weight behind it
did not. Selling it would have moved nothing. It's gone.

Money enters only through `donate()`, from a donor's own wallet, and leaves only through
`claim()`. The relayer that pays gas for contributions cannot touch it, and there's a test
that says so.

Payouts use a pull-based accumulator, so a donation costs the same gas whether there are
five contributors or fifty thousand — it never loops over them. The accumulator is whole
wei per unit of weight rather than scaled fixed-point, which makes an entitlement a plain
multiplication with nothing to truncate. The fixed-point version leaked a wei per flush;
the conservation test caught it before it ever reached a testnet.

A donation that doesn't divide evenly leaves a remainder pending for the next one — 0.001
ETH across weight 370 carries 260 wei. Nothing is lost, it just arrives later.

## Redeploying without losing anyone's work

Redeploying the contract starts an empty registry, so anything already submitted is
orphaned. That is not theoretical: it cost a contributor their entry twice during the
build before this existed.

```bash
npx tsx scripts/migrate.mts --from <old subgraph url> --dry-run   # see what would move
npx tsx scripts/migrate.mts --from <old subgraph url>
```

Entries are re-logged with `logFor`, so each one keeps its original contributor address
and its provenance — the weight goes to whoever earned it, not to whoever ran the script.
Matching is on contributor plus coordinates, so running it twice is safe.

## Running it

```bash
npm install
cp .env.example .env        # fill in the keys it names

npm run contracts:test      # 11 tests, mostly about the reward maths
npm run contracts:build
npm run sync:abi            # ABI → lib/ and subgraph/
npm run deploy              # → Base Sepolia, prints the env lines to paste back

npm --prefix subgraph run deploy   # → Subgraph Studio

npm run harvest -- --city london --limit 120   # OpenStreetMap → data/seed-london.json
npm run seed -- --city london --limit 120      # → onchain, as agent entries

npm run dev
```

Verification scripts, all against the live deployment rather than a local node:

| | |
|---|---|
| `npm run smoke` | write a toilet onchain, read it back out of The Graph |
| `npx tsx scripts/test-rewards.mts` | donate → accrue → claim, asserting conservation |
| `npx tsx scripts/test-third-party-agent.mts` | a stranger's agent contributing both ways |
| `npx tsx scripts/test-photo.mts <image>` | photo → IPFS → onchain → subgraph → back |
| `npx tsx scripts/test-judge.mts` | the judge, on cases with known answers |
| `npx tsx scripts/test-mcp.mts` | every MCP tool over stdio, including writes |
| `npm run judge -- --dry-run` | reason over live entries, write nothing |
| `npx tsx scripts/status.mts` | does the subgraph agree with the chain? |

## Notes from the build

Two failures worth writing down, because both were invisible.

**MapLibre 6 never starts its worker under Turbopack.** The map painted nothing while
reporting no errors: style, TileJSON and sprites all loaded, the canvas was sized, WebGL
was healthy, and not one vector tile was ever requested. MapLibre derives its worker URL
from `import.meta.url` and returns an empty string when that isn't an `http(s)` URL, which
is exactly what Turbopack hands it. We serve the worker from our own origin instead
(`scripts/copy-map-worker.mts`).

**A receipt does not mean the next read sees the transaction.** `sepolia.base.org` sits
behind a pool of nodes and regularly answers a read from a block or two back. It produced
a seeder reporting three toilets when six were onchain, a payout short by exactly one
transaction's gas, a gas estimate failing with "gas required exceeds allowance (0)"
against a funded wallet, and a weight of 3 where 6 was right. Every one looked like a
contract bug; none were. `lib/rpc.ts` polls until the world catches up. Pinning reads to
the receipt's block doesn't work — the public endpoint isn't an archive node.

## Stack

Next.js 16 · MapLibre GL 6 + OpenFreeMap · wagmi + viem · Solidity 0.8.28 with Hardhat 3 ·
The Graph (Subgraph Studio) · Base Sepolia · IPFS for photos

## Licence

MIT
