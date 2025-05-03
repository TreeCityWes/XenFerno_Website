import { Addresses, isContractDeployed } from './contracts'; // Import Addresses type and helper

// Define a shared type for pool information
export interface PoolInfo {
  pid: number;
  name: string;
  lpAddress: `0x${string}`; // Address of the LP token OR the single staking token
  token1Symbol: string;     // Symbol of the first token OR the single staking token
  token2Symbol: string;     // Symbol of the second token (empty string if single-sided)
  isSingleSided?: boolean; // Flag for single-sided staking
}

// Function to get ALL configured pools based on provided addresses
// Renamed from getFarmPools
export function getAllPools(addresses: Addresses): PoolInfo[] {
  const pools: PoolInfo[] = [
    // LP Pools - SPARX First
    {
      pid: 0,
      name: 'SPARX/cbXEN LP',
      lpAddress: addresses.LP_SPARX_CBXEN as `0x${string}`,
      token1Symbol: 'SPARX',
      token2Symbol: 'cbXEN',
      isSingleSided: false,
    },
    {
      pid: 3,
      name: 'SPARX/WETH LP',
      lpAddress: addresses.LP_SPARX_WETH as `0x${string}`,
      token1Symbol: 'SPARX',
      token2Symbol: 'WETH',
      isSingleSided: false,
    },
    {
      pid: 2,
      name: 'XBURN/SPARX LP',
      lpAddress: addresses.LP_XBURN_SPARX as `0x${string}`,
      token1Symbol: 'XBURN',
      token2Symbol: 'SPARX',
      isSingleSided: false,
    },
    {
      pid: 1,
      name: 'XBURN/WETH LP',
      lpAddress: addresses.LP_XBURN_WETH as `0x${string}`,
      token1Symbol: 'XBURN',
      token2Symbol: 'WETH',
      isSingleSided: false,
    },
    // Single-Sided Staking Pools
    {
      pid: 4, 
      name: 'Stake XBURN', // Simplified name
      lpAddress: addresses.xburn as `0x${string}`, // Use XBURN address
      token1Symbol: 'XBURN',
      token2Symbol: '', 
      isSingleSided: true,
    },
    {
      pid: 5, // New PID for SPARX staking
      name: 'Stake SPARX', 
      lpAddress: addresses.sparx as `0x${string}`, // Use sparx address (lowercase)
      token1Symbol: 'SPARX',
      token2Symbol: '', 
      isSingleSided: true,
    },
  ];

  // Filter out pools where the token address isn't valid/deployed for the network
  return pools.filter(pool => isContractDeployed(pool.lpAddress));
}

// Function to get only LP farm pools
export function getFarmPools(addresses: Addresses): PoolInfo[] {
    const allPools = getAllPools(addresses);
    return allPools.filter(pool => !pool.isSingleSided);
}

// Function to get only single-sided staking pools
export function getStakingPools(addresses: Addresses): PoolInfo[] {
    const allPools = getAllPools(addresses);
    return allPools.filter(pool => pool.isSingleSided);
}

// Remove the old static export
// export const FARM_POOLS: PoolInfo[] = [ ... ]; // REMOVE THIS 