import {
  BigDecimal,
  BigInt,
  JSONValue,
  JSONValueKind,
  TypedMap,
  json,
  log,
} from "@graphprotocol/graph-ts";
import {
  Claimed,
  Donated,
  ToiletLogged,
  ToiletRated,
} from "../generated/WorldWideWC/WorldWideWC";
import { Contributor, Donation, Global, Rating, Toilet } from "../generated/schema";

// Mirrors the constants in WorldWideWC.sol. If those change, change these.
const WEIGHT_HUMAN_LOG = 10;
const WEIGHT_AGENT_LOG = 3;
const WEIGHT_RATING = 1;

// Coordinates are int32 at 1e6 scale onchain.
const COORD_SCALE = BigDecimal.fromString("1000000");

// Compact payload keys. The other half of this contract lives in lib/payload.ts.
const K_NAME = "n";
const K_BUILDING = "b";
const K_ACCESS = "a";
const K_PRICE = "p";
const K_CURRENCY = "cur";
const K_CLEANLINESS = "c";
const K_SMELL = "sm";
const K_BUSYNESS = "bu";
const K_PAPER = "pa";
const K_BIDET = "bi";
const K_STAFFED = "st";
const K_MUSIC = "mu";
const K_ACCESSIBLE = "wh";
const K_CHANGING = "ch";
const K_OPENING_HOURS = "oh";
const K_STYLE = "sy";
const K_PHOTO = "ph";
const K_SOURCE_URL = "url";
const K_NOTE = "note";

// --- payload helpers --------------------------------------------------------
// Every one of these tolerates a missing or wrongly-typed key. A contributor with a
// hand-rolled client should not be able to halt indexing by sending `{"c": "very"}`.

function parsePayload(payload: string): TypedMap<string, JSONValue> | null {
  const result = json.try_fromString(payload);
  if (result.isError) {
    log.warning("unparseable payload: {}", [payload]);
    return null;
  }
  const value = result.value;
  if (value.kind != JSONValueKind.OBJECT) return null;
  return value.toObject();
}

function readString(obj: TypedMap<string, JSONValue> | null, key: string): string {
  if (obj == null) return "";
  const value = obj.get(key);
  if (value == null || value.kind != JSONValueKind.STRING) return "";
  return value.toString();
}

function readInt(obj: TypedMap<string, JSONValue> | null, key: string): i32 {
  if (obj == null) return 0;
  const value = obj.get(key);
  if (value == null || value.kind != JSONValueKind.NUMBER) return 0;
  return value.toI64() as i32;
}

/**
 * Tri-state. A key that is present and boolean is somebody's assertion either way; a key
 * that is absent means nobody has said, and that is a different fact from "no".
 */
function readKnown(obj: TypedMap<string, JSONValue> | null, key: string): string {
  if (obj == null) return "UNKNOWN";
  const value = obj.get(key);
  if (value == null || value.kind != JSONValueKind.BOOL) return "UNKNOWN";
  return value.toBool() ? "YES" : "NO";
}

// --- entity helpers ---------------------------------------------------------

function loadGlobal(): Global {
  let global = Global.load("global");
  if (global == null) {
    global = new Global("global");
    global.toiletCount = 0;
    global.humanToilets = 0;
    global.agentToilets = 0;
    global.ratingCount = 0;
    global.contributorCount = 0;
    global.totalWeight = BigInt.zero();
    global.totalDonated = BigInt.zero();
    global.totalClaimed = BigInt.zero();
    global.accPerWeight = BigInt.zero();
    global.poolPending = BigInt.zero();
  }
  return global as Global;
}

function loadContributor(address: string, timestamp: BigInt): Contributor {
  let contributor = Contributor.load(address);
  if (contributor == null) {
    contributor = new Contributor(address);
    contributor.toiletsLogged = 0;
    contributor.ratingsGiven = 0;
    contributor.weight = BigInt.zero();
    contributor.claimed = BigInt.zero();
    contributor.accrued = BigInt.zero();
    contributor.rewardDebt = BigInt.zero();
    contributor.firstSeenAt = timestamp;

    const global = loadGlobal();
    global.contributorCount += 1;
    global.save();
  }
  return contributor as Contributor;
}

// --- the reward accumulator -------------------------------------------------
// A line-for-line mirror of WorldWideWC.sol. It is duplicated here rather than read back
// from the contract so the leaderboard is a single GraphQL query with no RPC calls behind
// it — but that means the two must not drift. scripts/check-earnings.mts compares this
// against the contract's own pendingOf for every contributor.

/**
 * Moves whatever of `poolPending` divides evenly across the current weight into the
 * accumulator, keeping the undividable remainder for next time. Whole wei per unit of
 * weight, exactly as onchain: a scaled fixed-point version leaks.
 */
function flushPool(global: Global): void {
  if (global.totalWeight.isZero() || global.poolPending.isZero()) return;
  const share = global.poolPending.div(global.totalWeight);
  if (share.isZero()) return; // less than a wei each; wait for the pool to grow
  global.accPerWeight = global.accPerWeight.plus(share);
  global.poolPending = global.poolPending.minus(share.times(global.totalWeight));
}

function unsettled(contributor: Contributor, global: Global): BigInt {
  return contributor.weight.times(global.accPerWeight).minus(contributor.rewardDebt);
}

function settle(contributor: Contributor, global: Global): void {
  contributor.accrued = contributor.accrued.plus(unsettled(contributor, global));
  contributor.rewardDebt = contributor.weight.times(global.accPerWeight);
}

/**
 * Flushes before and after, like the contract: before so a donation that arrived earlier
 * is not diluted by this new contributor, after because the larger total may now divide a
 * remainder that previously could not be shared out.
 */
function addWeight(contributor: Contributor, weight: i32): void {
  const global = loadGlobal();

  flushPool(global);
  settle(contributor, global);

  contributor.weight = contributor.weight.plus(BigInt.fromI32(weight));
  global.totalWeight = global.totalWeight.plus(BigInt.fromI32(weight));
  contributor.rewardDebt = contributor.weight.times(global.accPerWeight);

  flushPool(global);
  global.save();
}

/**
 * Folds one 1-5 reading into a toilet's running average, ignoring the zeroes that mean
 * "didn't say". Sums and counts are stored rather than an incrementally-updated average,
 * because dividing a BigDecimal over and over drifts and adding integers does not.
 */
function addScore(toilet: Toilet, which: string, incoming: i32): void {
  if (incoming <= 0) return;

  if (which == "cleanliness") {
    toilet.cleanlinessSum += incoming;
    toilet.cleanlinessVotes += 1;
    toilet.avgCleanliness = BigDecimal.fromString(toilet.cleanlinessSum.toString()).div(
      BigDecimal.fromString(toilet.cleanlinessVotes.toString()),
    );
  } else if (which == "smell") {
    toilet.smellSum += incoming;
    toilet.smellVotes += 1;
    toilet.avgSmell = BigDecimal.fromString(toilet.smellSum.toString()).div(
      BigDecimal.fromString(toilet.smellVotes.toString()),
    );
  } else {
    toilet.busynessSum += incoming;
    toilet.busynessVotes += 1;
    toilet.avgBusyness = BigDecimal.fromString(toilet.busynessSum.toString()).div(
      BigDecimal.fromString(toilet.busynessVotes.toString()),
    );
  }
}

/**
 * A later first-hand report replaces an earlier one.
 *
 * Staleness is half of what makes existing toilet data useless — a roll of paper present
 * last year says nothing about today. So the toilet carries the newest definite answer,
 * while every Rating is kept immutably, which means the history of who said what and when
 * survives even though the headline value moves. A visitor who says nothing about a field
 * (UNKNOWN) never erases what somebody else established.
 */
function applyKnown(existing: string, incoming: string): string {
  return incoming == "UNKNOWN" ? existing : incoming;
}

// --- handlers ---------------------------------------------------------------

export function handleToiletLogged(event: ToiletLogged): void {
  const payload = parsePayload(event.params.payload);
  const contributorId = event.params.contributor.toHexString();
  const contributor = loadContributor(contributorId, event.block.timestamp);

  const toilet = new Toilet(event.params.id.toString());
  toilet.lat = BigDecimal.fromString(event.params.lat.toString()).div(COORD_SCALE);
  toilet.lng = BigDecimal.fromString(event.params.lng.toString()).div(COORD_SCALE);

  toilet.name = readString(payload, K_NAME);
  toilet.building = readString(payload, K_BUILDING);
  const access = readString(payload, K_ACCESS);
  toilet.access = access == "" ? "unknown" : access;
  toilet.price = readInt(payload, K_PRICE);
  const currency = readString(payload, K_CURRENCY);
  toilet.currency = currency == "" ? "GBP" : currency;

  toilet.cleanliness = readInt(payload, K_CLEANLINESS);
  toilet.smell = readInt(payload, K_SMELL);
  toilet.busyness = readInt(payload, K_BUSYNESS);
  toilet.hasPaper = readKnown(payload, K_PAPER);
  toilet.hasBidet = readKnown(payload, K_BIDET);
  toilet.isStaffed = readKnown(payload, K_STAFFED);
  toilet.hasMusic = readKnown(payload, K_MUSIC);
  toilet.isAccessible = readKnown(payload, K_ACCESSIBLE);
  toilet.hasChangingTable = readKnown(payload, K_CHANGING);
  toilet.openingHours = readString(payload, K_OPENING_HOURS);
  toilet.style = readString(payload, K_STYLE);
  toilet.photoUrl = readString(payload, K_PHOTO);

  // Provenance comes from the event, not the payload: the contract set the contributor's
  // weight from this same flag, so it is the only version of the fact that cost anything
  // to assert. A payload key saying otherwise is just a claim.
  toilet.source = event.params.isAgent ? "agent" : "human";
  toilet.sourceUrl = readString(payload, K_SOURCE_URL);
  toilet.contributor = contributorId;

  toilet.ratingCount = 0;
  toilet.avgCleanliness = BigDecimal.zero();
  toilet.avgSmell = BigDecimal.zero();
  toilet.avgBusyness = BigDecimal.zero();
  toilet.cleanlinessVotes = 0;
  toilet.smellVotes = 0;
  toilet.busynessVotes = 0;
  toilet.cleanlinessSum = 0;
  toilet.smellSum = 0;
  toilet.busynessSum = 0;

  // The original contributor's own reading is the first vote.
  addScore(toilet, "cleanliness", toilet.cleanliness);
  addScore(toilet, "smell", toilet.smell);
  addScore(toilet, "busyness", toilet.busyness);

  toilet.createdAt = event.block.timestamp;
  toilet.updatedAt = event.block.timestamp;
  toilet.blockNumber = event.block.number;
  toilet.txHash = event.transaction.hash;
  toilet.save();

  const isAgent = toilet.source == "agent";
  contributor.toiletsLogged += 1;
  addWeight(contributor, isAgent ? WEIGHT_AGENT_LOG : WEIGHT_HUMAN_LOG);
  contributor.save();

  const global = loadGlobal();
  global.toiletCount += 1;
  if (isAgent) {
    global.agentToilets += 1;
  } else {
    global.humanToilets += 1;
  }
  global.save();
}

export function handleToiletRated(event: ToiletRated): void {
  const toilet = Toilet.load(event.params.id.toString());
  if (toilet == null) {
    // The contract rejects ratings for toilets that don't exist, so this only happens if
    // the subgraph started indexing after the toilet was logged.
    log.warning("rating for unindexed toilet {}", [event.params.id.toString()]);
    return;
  }

  const payload = parsePayload(event.params.payload);
  const raterId = event.params.rater.toHexString();
  const rater = loadContributor(raterId, event.block.timestamp);

  const rating = new Rating(`${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`);
  rating.toilet = toilet.id;
  rating.rater = raterId;
  rating.cleanliness = readInt(payload, K_CLEANLINESS);
  rating.smell = readInt(payload, K_SMELL);
  rating.busyness = readInt(payload, K_BUSYNESS);
  rating.hasPaper = readKnown(payload, K_PAPER);
  rating.hasBidet = readKnown(payload, K_BIDET);
  rating.isStaffed = readKnown(payload, K_STAFFED);
  rating.isAccessible = readKnown(payload, K_ACCESSIBLE);
  rating.hasChangingTable = readKnown(payload, K_CHANGING);
  rating.hasMusic = readKnown(payload, K_MUSIC);
  rating.note = readString(payload, K_NOTE);
  rating.createdAt = event.block.timestamp;
  rating.txHash = event.transaction.hash;
  rating.save();

  addScore(toilet, "cleanliness", rating.cleanliness);
  addScore(toilet, "smell", rating.smell);
  addScore(toilet, "busyness", rating.busyness);

  toilet.hasPaper = applyKnown(toilet.hasPaper, rating.hasPaper);
  toilet.hasBidet = applyKnown(toilet.hasBidet, rating.hasBidet);
  toilet.isStaffed = applyKnown(toilet.isStaffed, rating.isStaffed);
  toilet.isAccessible = applyKnown(toilet.isAccessible, rating.isAccessible);
  toilet.hasChangingTable = applyKnown(toilet.hasChangingTable, rating.hasChangingTable);
  toilet.hasMusic = applyKnown(toilet.hasMusic, rating.hasMusic);

  // A visitor who describes the place fills in a blank character note, but never
  // overwrites what the original contributor wrote.
  const note = readString(payload, K_NOTE);
  if (toilet.style == "" && note != "") toilet.style = note;

  toilet.ratingCount += 1;
  toilet.updatedAt = event.block.timestamp;
  toilet.save();

  rater.ratingsGiven += 1;
  addWeight(rater, WEIGHT_RATING);
  rater.save();

  const global = loadGlobal();
  global.ratingCount += 1;
  global.save();
}

export function handleDonated(event: Donated): void {
  const donation = new Donation(
    `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`,
  );
  donation.donor = event.params.donor;
  donation.amount = event.params.amount;
  donation.note = event.params.note;
  donation.createdAt = event.block.timestamp;
  donation.txHash = event.transaction.hash;
  donation.save();

  const global = loadGlobal();
  global.totalDonated = global.totalDonated.plus(event.params.amount);
  global.poolPending = global.poolPending.plus(event.params.amount);
  flushPool(global);
  global.save();
}

export function handleClaimed(event: Claimed): void {
  const contributor = loadContributor(
    event.params.contributor.toHexString(),
    event.block.timestamp,
  );
  const global = loadGlobal();
  settle(contributor, global);
  contributor.accrued = BigInt.zero();
  contributor.claimed = contributor.claimed.plus(event.params.amount);
  contributor.save();

  global.totalClaimed = global.totalClaimed.plus(event.params.amount);
  global.save();
}
