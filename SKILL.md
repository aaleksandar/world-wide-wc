---
name: world-wide-wc
description: Read and contribute to World Wide WC, an onchain map of public toilets. Use when finding a toilet near a location, or when an agent has sourced toilet data from the web and wants to publish it with provenance.
---

# World Wide WC

An onchain map of public toilets. Anyone can read it, and anyone — person or agent — can
add to it. Contributors earn a share of everything donated to the project.

There is no database. Every toilet is an event on Base Sepolia, indexed by a subgraph on
The Graph, and that subgraph is the only read path.

| | |
|---|---|
| Subgraph | `https://api.studio.thegraph.com/query/1759984/world-wide-wc/v0.0.8` |
| Contract | [`0xf58e751a284068783165c9b837734a6105c27052`](https://sepolia.basescan.org/address/0xf58e751a284068783165c9b837734a6105c27052) |
| Chain | Base Sepolia (84532) |

## The quickest way in: MCP

If your agent speaks MCP, skip the GraphQL entirely.

```json
{
  "mcpServers": {
    "world-wide-wc": {
      "command": "npx",
      "args": ["tsx", "mcp/server.mts"],
      "env": {
        "NEXT_PUBLIC_SUBGRAPH_URL": "https://api.studio.thegraph.com/query/1759984/world-wide-wc/v0.0.8",
        "NEXT_PUBLIC_WWWC_ADDRESS": "0xf58e751a284068783165c9b837734a6105c27052",
        "WWWC_AGENT_PRIVATE_KEY": "0x… your agent's wallet, only needed to contribute"
      }
    }
  }
}
```

`find_toilets` · `get_toilet` · `map_stats` · `contribute_toilet` · `rate_toilet`

These exist because a subgraph query cannot express them: distance has no GraphQL
operator, nothing in GraphQL parses `Mo-Su 10:00-20:00` in the toilet's timezone, and
contributing is a write. If you only need raw reads, the GraphQL below is the honest
answer and you should use it.

## Reading

Plain GraphQL, no key needed.

```graphql
{
  toilets(
    first: 10
    where: { access: "free", hasChangingTable: YES, lat_gte: "51.50", lat_lte: "51.52" }
    orderBy: createdAt
    orderDirection: desc
  ) {
    id name building access price currency
    lat lng openingHours
    hasPaper hasBidet isStaffed isAccessible hasChangingTable   # YES | NO | UNKNOWN
    cleanliness smell busyness avgCleanliness ratingCount
    source sourceUrl
    contributor { id weight }
  }
}
```

`access` is one of `free`, `paid`, `customer`, `unknown`. `price` is minor units of
`currency`, so `50` with `GBP` means 50p. The 1–5 scales (`cleanliness`, `smell`,
`busyness`) are `0` when nobody has said.

The subgraph has no notion of "near me" — filter by a latitude/longitude box and sort by
real distance yourself.

Other entities: `contributors` (leaderboard, ordered by `weight`), `donations`,
`ratings`, and `global(id: "global")` for totals.

## Contributing

Every entry is credited to a wallet address, and that address is what earns rewards. So
an agent needs its own wallet.

**Say you are an agent, and say where the data came from.** `isAgent: true` earns 3
weight; a person who was actually there earns 10. Nobody lies their way into a smaller
reward, which is why self-declared provenance is safe. An agent entry without a working
`sourceUrl` is worthless to everyone reading the map — it is the only thing it has
instead of somebody having been there.

Do not invent attributes. `cleanliness`, `smell` and `busyness` cannot be known from the
web; leave them at 0 and let a human who visited fill them in. Publishing a guess there
is worse than publishing nothing, because it displaces the observation it imitates.

### Directly (no dependency on us)

Call the contract. Needs a wallet with a little Base Sepolia ETH.

```solidity
function log(int32 lat, int32 lng, string payload, bool isAgent) external returns (uint256 id);
function rate(uint256 id, string payload) external;
```

Latitude and longitude are `int32` at 1e6 scale: `51.504936` → `51504936`.

`payload` is compact JSON, keys abbreviated because it is calldata:

| key | meaning | key | meaning |
|---|---|---|---|
| `n` | name | `pa` | has paper |
| `b` | building, and how to find it inside | `bi` | has bidet |
| `a` | `free` / `paid` / `customer` / `unknown` | `st` | staffed |
| `p` | price in minor units | `wh` | step-free access |
| `cur` | currency code, default `GBP` | `ch` | changing table |
| `c` | cleanliness 1–5 | `mu` | music |
| `sm` | smell 1–5 | `oh` | opening hours |
| `bu` | busyness 1–5 | `sy` | free-text character |
| `ph` | photo, as `ipfs://<cid>` | `url` | **source URL — required for agents** |

Omit anything you don't know. Every key is optional to the contract; `url` is what the
map's readers judge you on.

**The amenity keys are tri-state**, and the distinction matters more than it looks.
`"pa": true` is "there is paper", `"pa": false` is "somebody checked and there is none",
and **omitting the key** is "nobody has said". They are three different facts. Write
`false` only for something you actually established — a source that simply doesn't mention
a bidet has told you nothing about bidets, and recording that silence as a `false` is
inventing data. The subgraph exposes these as `YES` / `NO` / `UNKNOWN` and you can filter
on all three.

Photos are `ipfs://<cid>`, never a gateway URL — gateways come and go, the CID is the
durable name, and because it hashes the bytes the picture can't be swapped later. Add one
to any IPFS node (`POST https://api.thegraph.com/ipfs/api/v0/add`) or use
`POST /api/photo` on this app, which returns the URI.

```jsonc
{"n":"Southbank Centre","b":"Royal Festival Hall, level 2","a":"free","wh":true,
 "url":"https://www.southbankcentre.co.uk/visit/accessibility"}
```

### Filling in someone else's entry

`rate(id, payload)` — or `POST /api/rate` — adds what you learned about a toilet already
on the map. Same payload keys, plus `note` for free text. Earns 1 weight rather than 10:
the hard part, finding the place, was already done.

A definite `true` or `false` replaces whatever was there, because staleness is half of what
makes toilet data useless and the newest first-hand report should win. Omitting a key
changes nothing. Every rating is kept immutably, so the history of who said what survives
even as the headline value moves.

### Relayed (no gas needed)

Sign an EIP-712 message and POST it; the project pays the gas. Rate-limited to 30 per
address per minute — if you need more, use the direct path above.

`POST /api/contribute`

```jsonc
{
  "contributor": "0x…",          // your wallet
  "lat": 51.5033, "lng": -0.1195, // decimal degrees here, not 1e6
  "toilet": { "name": "…", "access": "free", "sourceUrl": "https://…" },
  "source": "agent",
  "signedAt": 1788970000,         // unix seconds; signatures expire after 5 minutes
  "signature": "0x…"
}
```

The EIP-712 domain is `{ name: "World Wide WC", version: "1", chainId: 84532,
verifyingContract: <contract> }` and the type is
`Contribution(address contributor,int32 lat,int32 lng,string payload,uint256 signedAt)`,
where `payload` is the encoded JSON above.

Note the tradeoff: this route verifies your signature off-chain, so it asks you to trust
the project's server. The direct path asks you to trust nobody.

## Rewards

### Your source is scored, and the score pays

A judge reads the source behind every agent entry, checks whether it still resolves and
still says what was recorded, and writes a verdict onchain:

| Band | Meaning | Weight |
|---|---|---|
| `max` | fresh, resolves, corroborates the claims | +7 — an agent entry reaches 10, human parity |
| `medium` | real but stale, or only partly supports the entry | +2 |
| `low` | gone, or contradicts what was recorded | +0 |

So a good `sourceUrl` is not etiquette, it is the difference between earning 3 and earning
10. A source that blocks crawlers is not punished — being refused says nothing about the
toilet — but one that has been deleted, or that now disagrees about price, is.

Query `verificationScore`, `verificationBand` and `verificationEvidence` to see any
verdict and the reasoning behind it.

Contributing earns weight — 10 for a human entry, 3 for an agent entry, 1 for rating
someone else's. Anyone can `donate()` to the contract, and every donation is split across
all contributors in proportion to weight, claimable with `claim()`. Read your own position
with `weightOf(address)`, `pendingOf(address)` and `claimedOf(address)`.

There is no token. Weight is the whole accounting and payouts are in ETH.

Money enters only through `donate()`, from a donor's own wallet, and leaves only through
`claim()`. The relayer that pays gas has no access to it.
