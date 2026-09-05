// EVM wallet config for the DEX tab.
//
// This is a desktop app (no browser extension in the webview), so we connect to
// the user's phone wallet by QR using WalletConnect, which is the standard
// protocol built for exactly that. MetaMask's own connect library assumes
// "desktop == extension" and refuses the QR path on desktop, so we don't use it
// here. The WalletConnect modal is dark-themed and has no "install extension"
// button; the user scans the QR with MetaMask (or any wallet) on their phone.

import { http, createConfig } from "wagmi";
import { mainnet } from "wagmi/chains";
import { walletConnect } from "wagmi/connectors";
import { QueryClient } from "@tanstack/react-query";

// WalletConnect (reown) project id for Divi Desktop, created in the Reown dashboard.
const WC_PROJECT_ID = "9b9f353a0714b1316c3825f36d39d657";

export const evmConfig = createConfig({
  chains: [mainnet],
  connectors: [
    walletConnect({
      projectId: WC_PROJECT_ID,
      showQrModal: true,
      qrModalOptions: { themeMode: "dark" },
      metadata: {
        name: "Divi Desktop",
        description: "Swap eDIVI on Uniswap from the Divi Desktop wallet",
        url: "https://diviproject.org",
        icons: ["https://diviproject.org/favicon.ico"],
      },
    }),
  ],
  transports: {
    [mainnet.id]: http("https://ethereum-rpc.publicnode.com"),
  },
});

export const dexQueryClient = new QueryClient();

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
