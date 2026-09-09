import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther } from "viem";

/**
 * These tests are all about the reward accumulator. Everything else the contract does is
 * emitting events for the subgraph to index, which the subgraph tests cover — but the
 * split of donated money is the one place a quiet bug takes real funds from real people.
 */
describe("WorldWideWC rewards", () => {
  let viem: Awaited<ReturnType<typeof network.getOrCreate>>["viem"];
  let owner: `0x${string}`;
  let relayer: `0x${string}`;
  let alice: `0x${string}`;
  let bob: `0x${string}`;
  let carol: `0x${string}`;
  let donor: `0x${string}`;

  before(async () => {
    ({ viem } = await network.getOrCreate("default"));
    const clients = await viem.getWalletClients();
    [owner, relayer, alice, bob, carol, donor] = clients.map((c) => c.account.address);
  });

  async function deploy() {
    const wc = await viem.deployContract("WorldWideWC", [owner, relayer]);
    const asRelayer = await viem.getContractAt("WorldWideWC", wc.address, {
      client: { wallet: (await viem.getWalletClients())[1] },
    });
    return { wc, asRelayer };
  }

  const LONDON_LAT = 51_504_936;
  const LONDON_LNG = -127_647;

  async function log(
    asRelayer: Awaited<ReturnType<typeof deploy>>["asRelayer"],
    who: `0x${string}`,
    isAgent = false,
  ) {
    await asRelayer.write.logFor([who, LONDON_LAT, LONDON_LNG, "{}", isAgent]);
  }

  it("mints WC one-for-one with the weight earned", async () => {
    const { wc, asRelayer } = await deploy();

    await log(asRelayer, alice);
    await log(asRelayer, bob, true);

    assert.equal(await wc.read.balanceOf([alice]), parseEther("10"));
    assert.equal(await wc.read.balanceOf([bob]), parseEther("3"));
    assert.equal(await wc.read.totalWeight(), 13n);
  });

  it("splits a donation across contributors in proportion to weight", async () => {
    const { wc, asRelayer } = await deploy();

    await log(asRelayer, alice); // weight 10
    await log(asRelayer, bob, true); // weight 3

    await wc.write.donate(["for the cause"], { value: parseEther("1.3") });

    assert.equal(await wc.read.pendingOf([alice]), parseEther("1"));
    assert.equal(await wc.read.pendingOf([bob]), parseEther("0.3"));
  });

  it("does not dilute an earlier donation with a later contributor", async () => {
    const { wc, asRelayer } = await deploy();

    await log(asRelayer, alice);
    await wc.write.donate(["first"], { value: parseEther("1") });

    // Carol shows up after the money did — she gets none of it.
    await log(asRelayer, carol);
    assert.equal(await wc.read.pendingOf([alice]), parseEther("1"));
    assert.equal(await wc.read.pendingOf([carol]), 0n);

    // ...but she shares the next one equally, both being weight 10.
    await wc.write.donate(["second"], { value: parseEther("1") });
    assert.equal(await wc.read.pendingOf([alice]), parseEther("1.5"));
    assert.equal(await wc.read.pendingOf([carol]), parseEther("0.5"));
  });

  it("holds a donation that arrives before anyone has contributed, then pays it out", async () => {
    const { wc, asRelayer } = await deploy();

    await wc.write.donate(["early"], { value: parseEther("2") });
    assert.equal(await wc.read.poolPending(), parseEther("2"));

    await log(asRelayer, alice);
    assert.equal(await wc.read.poolPending(), 0n);
    assert.equal(await wc.read.pendingOf([alice]), parseEther("2"));
  });

  it("conserves every wei across many donations and claims", async () => {
    const { wc, asRelayer } = await deploy();
    const publicClient = await viem.getPublicClient();

    await log(asRelayer, alice);
    await log(asRelayer, bob, true);
    await wc.write.donate(["one"], { value: 1_000_000_007n }); // deliberately indivisible
    await log(asRelayer, carol);
    await asRelayer.write.rateFor([1n, bob, "{}"]);
    await wc.write.donate(["two"], { value: 3_333_333_331n });

    const contributors = [alice, bob, carol];
    let owed = 0n;
    for (const who of contributors) owed += await wc.read.pendingOf([who]);

    const donated = await wc.read.totalDonated();
    const pending = await wc.read.poolPending();

    // Nothing invented, nothing lost: what is owed plus what is still undividable is
    // exactly what was donated.
    assert.equal(owed + pending, donated);

    // And the contract actually holds it.
    assert.equal(await publicClient.getBalance({ address: wc.address }), donated);
  });

  it("pays out on claim and refuses a second empty claim", async () => {
    const { wc, asRelayer } = await deploy();
    const publicClient = await viem.getPublicClient();
    const wallets = await viem.getWalletClients();
    const aliceWallet = wallets[2];

    await log(asRelayer, alice);
    await wc.write.donate(["for alice"], { value: parseEther("1") });

    const before = await publicClient.getBalance({ address: alice });
    const asAlice = await viem.getContractAt("WorldWideWC", wc.address, {
      client: { wallet: aliceWallet },
    });
    const hash = await asAlice.write.claim();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const gas = receipt.gasUsed * receipt.effectiveGasPrice;

    assert.equal(await publicClient.getBalance({ address: alice }), before + parseEther("1") - gas);
    assert.equal(await wc.read.claimedOf([alice]), parseEther("1"));
    assert.equal(await wc.read.pendingOf([alice]), 0n);

    await assert.rejects(asAlice.write.claim(), /NothingToClaim/);
  });

  it("only lets the relayer write, and only the owner change the relayer", async () => {
    const { wc } = await deploy();
    await assert.rejects(
      wc.write.logFor([alice, LONDON_LAT, LONDON_LNG, "{}", false]),
      /NotRelayer/,
    );

    const wallets = await viem.getWalletClients();
    const asAlice = await viem.getContractAt("WorldWideWC", wc.address, {
      client: { wallet: wallets[2] },
    });
    await assert.rejects(asAlice.write.setRelayer([alice]), /OwnableUnauthorizedAccount/);
  });

  it("rejects a rating for a toilet that does not exist", async () => {
    const { asRelayer } = await deploy();
    await assert.rejects(asRelayer.write.rateFor([1n, alice, "{}"]), /NoSuchToilet/);
  });
});
