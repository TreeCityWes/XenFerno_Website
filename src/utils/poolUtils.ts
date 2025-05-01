import { Addresses } from '../config/contracts';
import { PoolInfoInternal } from '../features/Farm/FarmTab'; // Adjust path if needed

// Helper function to map LP address to name/symbols
export function mapLpAddressToInfo(lpAddress: `0x${string}`, addresses: Addresses): Omit<PoolInfoInternal, 'pid' | 'lpAddress' | 'allocPoint'> {
  switch (lpAddress?.toLowerCase()) { // Ensure lowercase comparison
    case addresses.LP_SPARX_WETH?.toLowerCase():
      return { name: 'SPARX/WETH LP', token1Symbol: 'SPARX', token2Symbol: 'WETH', isSingleSided: false };
    case addresses.LP_XBURN_WETH?.toLowerCase():
      return { name: 'XBURN/WETH LP', token1Symbol: 'XBURN', token2Symbol: 'WETH', isSingleSided: false };
    case addresses.LP_XBURN_SPARX?.toLowerCase():
      return { name: 'XBURN/SPARX LP', token1Symbol: 'XBURN', token2Symbol: 'SPARX', isSingleSided: false };
    case addresses.LP_SPARX_CBXEN?.toLowerCase():
      return { name: 'SPARX/CBXEN LP', token1Symbol: 'SPARX', token2Symbol: 'CBXEN', isSingleSided: false };
    case addresses.sparx?.toLowerCase(): // Single-sided SPARX
      return { name: 'Stake SPARX', token1Symbol: 'SPARX', token2Symbol: '', isSingleSided: true };
    // Add other single-sided pools if needed
    case addresses.xburn?.toLowerCase(): // Single-sided XBURN
      return { name: 'Stake XBURN', token1Symbol: 'XBURN', token2Symbol: '', isSingleSided: true };
    default:
      console.warn("mapLpAddressToInfo: Unknown LP address:", lpAddress);
      // Return a generic unknown pool structure
      return { name: `Unknown (${lpAddress.substring(0, 6)}...)`, token1Symbol: '?', token2Symbol: '?', isSingleSided: false };
  }
} 