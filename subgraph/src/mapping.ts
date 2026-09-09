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

function readBool(obj: TypedMap<string, JSONValue> | null, key: string): boolean {
  if (obj == null) return false;
  const value = obj.get(key);
  if (value == null || value.kind != JSONValueKind.BOOL) return false;
  return value.toBool();
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
    contributor.firstSeenAt = timestamp;

    const global = loadGlobal();
    global.contributorCount += 1;
    global.save();
  }
  return contributor as Contributor;
}

function addWeight(contributor: Contributor, weight: i32): void {
  contributor.weight = contributor.weight.plus(BigInt.fromI32(weight));
  const global = loadGlobal();
  global.totalWeight = global.totalWeight.plus(BigInt.fromI32(weight));
  global.save();
}

/**
 * Mean cleanliness over the original entry and every rating since, ignoring the zeroes
 * that mean "didn't say". Recomputed incrementally: a `sum / count` kept on the entity
 * would need two more fields to say the same thing.
 */
function recomputeCleanliness(toilet: Toilet, incoming: i32): void {
  if (incoming <= 0) return;
  const previousCount = toilet.avgCleanliness.equals(BigDecimal.zero())
    ? 0
    : toilet.ratingCount;
  const previousTotal = toilet.avgCleanliness.times(
    BigDecimal.fromString(previousCount.toString()),
  );
  const newCount = previousCount + 1;
  toilet.avgCleanliness = previousTotal
    .plus(BigDecimal.fromString(incoming.toString()))
    .div(BigDecimal.fromString(newCount.toString()));
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
  toilet.hasPaper = readBool(payload, K_PAPER);
  toilet.hasBidet = readBool(payload, K_BIDET);
  toilet.isStaffed = readBool(payload, K_STAFFED);
  toilet.hasMusic = readBool(payload, K_MUSIC);
  toilet.isAccessible = readBool(payload, K_ACCESSIBLE);
  toilet.hasChangingTable = readBool(payload, K_CHANGING);
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
  recomputeCleanliness(toilet, toilet.cleanliness);

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
  rating.note = readString(payload, K_NOTE);
  rating.createdAt = event.block.timestamp;
  rating.txHash = event.transaction.hash;
  rating.save();

  recomputeCleanliness(toilet, rating.cleanliness);
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
  global.save();
}

export function handleClaimed(event: Claimed): void {
  const contributor = loadContributor(
    event.params.contributor.toHexString(),
    event.block.timestamp,
  );
  contributor.claimed = contributor.claimed.plus(event.params.amount);
  contributor.save();

  const global = loadGlobal();
  global.totalClaimed = global.totalClaimed.plus(event.params.amount);
  global.save();
}
