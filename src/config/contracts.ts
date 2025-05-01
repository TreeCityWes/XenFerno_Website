import { contractAddresses } from '../constants/contractAddresses';
import { Chain, sepolia, mainnet } from 'wagmi/chains';

// Define the Addresses type based on the shape of the Sepolia config
// Explicitly define the type to include all expected keys
export type Addresses = {
    readonly burner: `0x${string}`;
    readonly sparx: `0x${string}`;
    readonly farm: `0x${string}`;
    // readonly LP_CBXEN_XBURN: `0x${string}`; // Removed as it's not in the current config
    readonly LP_XBURN_WETH: `0x${string}`;
    readonly LP_XBURN_SPARX: `0x${string}`;
    readonly LP_SPARX_WETH: `0x${string}`;
    readonly LP_SPARX_CBXEN: `0x${string}`; // Kept this key
    readonly xburn: `0x${string}`;
    readonly cbxen: `0x${string}`; // Kept this key
    readonly router: `0x${string}`;
    // Add other optional keys if needed, e.g., readonly WETH?: `0x${string}`;
};


// Helper function to get addresses based on chainId
export function getAddressesForChain(chainId: number | undefined): Addresses {
  // Always return Sepolia addresses for now, as mainnet is incomplete
  // and Sepolia matches the Addresses type.
  if (chainId !== sepolia.id) {
      console.warn(`ChainId ${chainId} detected, but returning Sepolia addresses as mainnet is not configured.`);
  }
  // Use type assertion as the constant might temporarily mismatch the explicit type
  return contractAddresses.sepolia as Addresses; 
}

// Keep the helper function
export const isContractDeployed = (address: string | undefined) => {
  return !!address && address !== '' && address !== '0x0000000000000000000000000000000000000000';
}; 