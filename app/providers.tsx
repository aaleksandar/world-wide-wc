"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { chain, rpcUrl } from "@/lib/chain";

/**
 * Injected wallets only. RainbowKit would look nicer but wants a WalletConnect project id,
 * and a wallet is optional here anyway — you need one to contribute or donate, never to
 * look at the map.
 */
const config = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: http(rpcUrl) },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
