/**
 * Deploys WorldWideWC to Base Sepolia and prints the env lines to paste back.
 *
 *   npm run deploy
 *
 * Deliberately a plain viem script rather than a Hardhat task: the same client setup is
 * what the relayer uses in the app, so there is one way of talking to the chain here.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, rpcUrl } from "../lib/chain";

const artifact = JSON.parse(
  readFileSync("contracts/artifacts/contracts/WorldWideWC.sol/WorldWideWC.json", "utf8"),
);

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!deployerKey || deployerKey === "0x") {
  throw new Error("DEPLOYER_PRIVATE_KEY is not set — see .env.example");
}

const deployer = privateKeyToAccount(deployerKey);
const relayerKey = (process.env.RELAYER_PRIVATE_KEY as `0x${string}`) || deployerKey;
const relayer = privateKeyToAccount(relayerKey);

const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });

const balance = await publicClient.getBalance({ address: deployer.address });
console.log(`deployer ${deployer.address} — ${formatEther(balance)} ETH`);
console.log(`relayer  ${relayer.address}`);
if (balance === 0n) {
  throw new Error(
    `${deployer.address} has no Base Sepolia ETH. Fund it at https://portal.cdp.coinbase.com/products/faucet`,
  );
}

const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode as `0x${string}`,
  args: [deployer.address, relayer.address],
});
console.log(`deploy tx ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error(`deployment failed: ${receipt.status}`);
}

console.log(`\ndeployed to ${receipt.contractAddress} in block ${receipt.blockNumber}`);
console.log(`${chain.blockExplorers.default.url}/address/${receipt.contractAddress}\n`);
console.log("Add to .env:");
console.log(`NEXT_PUBLIC_WWWC_ADDRESS=${receipt.contractAddress}`);
console.log(`NEXT_PUBLIC_WWWC_START_BLOCK=${receipt.blockNumber}`);
