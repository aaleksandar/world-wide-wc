/** A quick donation, for exercising the reward path. Usage: npx tsx scripts/donate.mts 0.002 */
import "dotenv/config";
import { formatEther, parseEther } from "viem";
import { contractAddress, explorerTxUrl } from "../lib/chain";
import { publicClient, relayerClient } from "../lib/relayer";
import { wwwcAbi } from "../lib/wwwc-abi";

const amount = parseEther(process.argv[2] ?? "0.002");
const wallet = relayerClient();

const hash = await wallet.writeContract({
  address: contractAddress, abi: wwwcAbi, functionName: "donate",
  args: [process.argv[3] ?? "for the mappers of London"],
  value: amount, chain: wallet.chain, account: wallet.account!,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`donated ${formatEther(amount)} ETH — ${receipt.status}`);
console.log(explorerTxUrl(hash));
