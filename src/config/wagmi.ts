// Remove Web3Modal imports
// import { createWeb3Modal } from '@web3modal/wagmi/react'
// import { defaultWagmiConfig } from '@web3modal/wagmi/react'

// Import RainbowKit/Wagmi v2 config methods
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi' // Import http transport
import { mainnet, sepolia } from 'wagmi/chains'

// 1. Get projectId from WalletConnect Cloud
const projectId = '130ac65a7359514da838b1669f2e2537' 
if (!projectId) throw new Error('Project ID is not set')

// 2. Create wagmiConfig using RainbowKit's helper
const metadata = {
  appName: 'XenFerno Farms', // Use appName for RainbowKit
  description: 'XenFerno Farms - Stake LP and earn rewards',
  url: 'https://xburn.farms', // origin must match your domain & subdomain
  icons: ['https://avatars.githubusercontent.com/u/37784886']
}

const chains = [mainnet, sepolia] as const 

// Use getDefaultConfig from RainbowKit
export const config = getDefaultConfig({
  appName: metadata.appName,
  projectId,
  chains,
  // Optional: Add transports if needed (e.g., for Alchemy/Infura)
  // transports: {
  //   [mainnet.id]: http(),
  //   [sepolia.id]: http(),
  // },
  // Optional: SIWE configuration
  // siwe: true, 
})

// 3. No separate modal creation needed for RainbowKit config
// createWeb3Modal({...}) 