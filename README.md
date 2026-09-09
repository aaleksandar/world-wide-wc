# World Wide WC

**Mapping the world wide WC.** A decentralised, agentic map of public toilets, where the
people and agents who contribute the data are the ones who get paid for it.

Built for [ETHOnline 2026](https://ethglobal.com/events/ethonline2026) — targeting
The Graph's *Best AI Tooling or AI Use Case* track.

## The problem

Google Maps is bad at toilets. Not all are mapped, the information goes stale, the building
is usually not identified, and you can never tell whether it's free, customers-only, clean,
staffed, or stocked with paper until you're standing in front of it.

## The idea

1. **Humans and AI agents both contribute**, and every entry carries provenance — a wallet
   address for a human, a source URL for an agent.
2. **Every contribution is an on-chain event.** A subgraph on The Graph is the only read
   path in this app; there is no database.
3. **Donations to the toilet cause flow back to contributors** as claimable rewards,
   weighted by what they contributed.

## Status

Work in progress — built during the hackathon, committed as it goes.

## Licence

MIT
