import React from 'react'
import { Box, VStack, Heading, Text, SimpleGrid, Card, CardBody, Flex, Icon, Image, Grid, List, ListItem, Center } from '@chakra-ui/react'
import { useMemo, useState, useEffect } from 'react'
import PoolCard from './PoolCard'
import { LiquidityPool } from './types'
import { useAccount, useReadContracts } from 'wagmi'
import { getAddressesForChain, Addresses, isContractDeployed } from '../../config/contracts'
import erc20Abi from '../../abis/ERC20.json' with { type: 'json' }
import farmAbi from '../../abis/SparxFarm.json' with { type: 'json' }
import { formatUnits, type Abi, zeroAddress, Address } from 'viem'
import { sepolia } from 'wagmi/chains'
import { InfoIcon, WarningIcon } from '@chakra-ui/icons'

// Correct ABI typing
const erc20AbiTyped = erc20Abi as unknown as Abi;
const farmAbiTyped = farmAbi as Abi;

// Helper function to map token symbols to known addresses
// Pass currentAddresses now
const getTokenAddress = (symbol: string, currentAddresses: Addresses): Address | undefined => {
  const mapping: Record<string, string | undefined> = {
    'XBURN': currentAddresses.xburn,
    'SPARX': currentAddresses.sparx,
    'cbXEN': currentAddresses.cbxen,
    'WETH': sepolia.nativeCurrency.symbol === 'ETH' ? '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' : undefined
  };
  const address = mapping[symbol]
  return address && isContractDeployed(address) ? address as Address : undefined;
};

// Define minimal UniswapV2 Pair ABI
const pairAbi = [
  {
    "constant": true,
    "inputs": [],
    "name": "getReserves",
    "outputs": [
      { "internalType": "uint112", "name": "_reserve0", "type": "uint112" },
      { "internalType": "uint112", "name": "_reserve1", "type": "uint112" },
      { "internalType": "uint32", "name": "_blockTimestampLast", "type": "uint32" }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "token0",
    "outputs": [ { "internalType": "address", "name": "", "type": "address" } ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "token1",
    "outputs": [ { "internalType": "address", "name": "", "type": "address" } ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// Make STATIC_POOLS a function that accepts addresses
const getStaticPoolDefinitions = (currentAddresses: Addresses): (Pick<LiquidityPool, 'name' | 'address' | 'token1' | 'token2' | 'pid'>)[] => [
  // Reordered based on PID (0, 1, 2, 3) to match Farm tab order
  {
    name: 'SPARX/cbXEN LP',
    address: currentAddresses.LP_SPARX_CBXEN as Address,
    token1: 'SPARX',
    token2: 'cbXEN',
    pid: 0,
  },
  {
    name: 'XBURN/WETH LP',
    address: currentAddresses.LP_XBURN_WETH as Address,
    token1: 'XBURN',
    token2: 'WETH',
    pid: 1,
  },
  {
    name: 'XBURN/SPARX LP',
    address: currentAddresses.LP_XBURN_SPARX as Address,
    token1: 'XBURN',
    token2: 'SPARX',
    pid: 2,
  },
  {
    name: 'SPARX/WETH LP',
    address: currentAddresses.LP_SPARX_WETH as Address,
    token1: 'SPARX',
    token2: 'WETH',
    pid: 3,
  },
].filter(pool => isContractDeployed(pool.address));

// --- Placeholder Prices & Constants ---
const BLOCKS_PER_YEAR = 2628000; // Approx for 12s blocks
const PLACEHOLDER_PRICES: Record<string, number> = {
  'WETH': 3500,
  'SPARX': 0.01,
  'XBURN': 0.10,
  'cbXEN': 0.000001,
  // Add other potential tokens if needed
};

// Define props for the tab component
interface TabProps {
  isActive: boolean;
}

// Structure to hold reserves data mapped by pair address
interface ReservesData {
  reserve0: bigint;
  reserve1: bigint;
  token0: Address;
  token1: Address;
}

function LiquidityTab({ isActive }: TabProps) {
  // Get chain and dynamic addresses
  const { address: userAddress, chain } = useAccount();
  const currentAddresses = useMemo(() => getAddressesForChain(chain?.id), [chain?.id]);
  const uniswapRouterAddress = useMemo(() => {
      const routerAddr = currentAddresses.router;
      return routerAddr && isContractDeployed(routerAddr) ? routerAddr as Address : zeroAddress;
  }, [currentAddresses]);
  const farmAddress = useMemo(() => {
      const farmAddr = currentAddresses.farm;
      return farmAddr && isContractDeployed(farmAddr) ? farmAddr as Address : zeroAddress;
  }, [currentAddresses]);
  
  // Get dynamic pool definitions (Memoize this)
  const currentStaticPools = useMemo(() => getStaticPoolDefinitions(currentAddresses), [currentAddresses]);

  // Derive token addresses needed for price calculation (moved outside poolsWithData memo)
  const wethAddress = useMemo(() => {
    // Manually define Sepolia WETH for price calculations if not in config
    return chain?.id === sepolia.id ? '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' as Address : undefined;
  }, [chain?.id]);
  const sparxAddress = useMemo(() => getTokenAddress('SPARX', currentAddresses), [currentAddresses]);
  const xburnAddress = useMemo(() => getTokenAddress('XBURN', currentAddresses), [currentAddresses]);

  // --- State for stakingTokens order ---
  const [stakingTokensOrder, setStakingTokensOrder] = useState<Address[]>([]);

  // === Contract Calls Setup ===
  const contractsToRead = useMemo(() => {
    // Use dynamic addresses and check for zeroAddress
    if (!userAddress || !chain || uniswapRouterAddress === zeroAddress) return [];

    const calls: any[] = [];
    
    // Add calls for Farm general data (only once)
    // Check if farm address is deployed
    if (farmAddress !== zeroAddress) { 
      calls.push({ address: farmAddress, abi: farmAbiTyped, functionName: 'currentRate', chainId: chain.id, dataType: 'farmCurrentRate', poolName: '__farm__' });
      calls.push({ address: farmAddress, abi: farmAbiTyped, functionName: 'totalAllocPoint', chainId: chain.id, dataType: 'farmTotalAllocPoint', poolName: '__farm__' });
      // --- Add call to stakingTokens for ordering ---
      calls.push({ address: farmAddress, abi: farmAbiTyped, functionName: 'stakingTokens', chainId: chain.id, dataType: 'stakingTokensOrder', poolName: '__farm__' });
    }

    // Use dynamic pool definitions
    currentStaticPools.forEach(pool => {
      const poolAddress = pool.address;
      // Get token addresses dynamically
      const token1Addr = getTokenAddress(pool.token1, currentAddresses); 
      const token2Addr = getTokenAddress(pool.token2, currentAddresses);

      // Common Pool Data (Reserves, Tokens)
      calls.push({ address: poolAddress, abi: pairAbi, functionName: 'getReserves', poolName: pool.name, dataType: 'displayPoolReserves', chainId: chain.id, poolAddress: poolAddress }); 
      calls.push({ address: poolAddress, abi: pairAbi, functionName: 'token0', poolName: pool.name, dataType: 'displayPoolToken0', chainId: chain.id, poolAddress: poolAddress });
      calls.push({ address: poolAddress, abi: pairAbi, functionName: 'token1', poolName: pool.name, dataType: 'displayPoolToken1', chainId: chain.id, poolAddress: poolAddress });

      // User Specific Data
      calls.push({ address: poolAddress, abi: erc20AbiTyped, functionName: 'balanceOf', args: [userAddress], poolName: pool.name, dataType: 'userLpBalance', chainId: chain.id });
      calls.push({ address: poolAddress, abi: erc20AbiTyped, functionName: 'allowance', args: [userAddress, uniswapRouterAddress], poolName: pool.name, dataType: 'lpTokenAllowance', chainId: chain.id });

      if (token1Addr) {
        calls.push({ address: token1Addr, abi: erc20AbiTyped, functionName: 'balanceOf', args: [userAddress], poolName: pool.name, dataType: 'userToken1Balance', chainId: chain.id });
        calls.push({ address: token1Addr, abi: erc20AbiTyped, functionName: 'allowance', args: [userAddress, uniswapRouterAddress], poolName: pool.name, dataType: 'token1Allowance', chainId: chain.id });
      }
      
      if (token2Addr) {
        calls.push({ address: token2Addr, abi: erc20AbiTyped, functionName: 'balanceOf', args: [userAddress], poolName: pool.name, dataType: 'userToken2Balance', chainId: chain.id });
        calls.push({ address: token2Addr, abi: erc20AbiTyped, functionName: 'allowance', args: [userAddress, uniswapRouterAddress], poolName: pool.name, dataType: 'token2Allowance', chainId: chain.id });
      }

      // Add call for pool allocPoint if farm is deployed
      if (farmAddress !== zeroAddress) { 
         calls.push({ address: farmAddress, abi: farmAbiTyped, functionName: 'poolInfo', args: [BigInt(pool.pid)], poolName: pool.name, dataType: 'poolAllocPoint', chainId: chain.id });
      }
    });

    // --- Data for Pricing Pairs (Use dynamic addresses) ---
    // This section only for price calculations - we need to store these in the displayPoolDataMap too
    const pricingPairs: { address?: Address, name: string }[] = [
        { address: currentAddresses.LP_SPARX_WETH as Address | undefined, name: 'SPARX/WETH LP' }, // Changed name format to match pool names
        { address: currentAddresses.LP_XBURN_WETH as Address | undefined, name: 'XBURN/WETH LP' }, // Changed name format to match pool names
    ];

    pricingPairs.forEach(pair => {
        if (pair.address && isContractDeployed(pair.address)) {
            const currentPairAddress = pair.address;
            // Add pricing pairs to displayPoolDataMap by using the same poolName format
            calls.push({ address: currentPairAddress, abi: pairAbi, functionName: 'getReserves', poolName: pair.name, poolAddress: currentPairAddress, dataType: 'pricingPairReserves', chainId: chain.id });
            calls.push({ address: currentPairAddress, abi: pairAbi, functionName: 'token0', poolName: pair.name, poolAddress: currentPairAddress, dataType: 'pricingPairToken0', chainId: chain.id });
            calls.push({ address: currentPairAddress, abi: pairAbi, functionName: 'token1', poolName: pair.name, poolAddress: currentPairAddress, dataType: 'pricingPairToken1', chainId: chain.id });
        }
    });
    
    return calls;
  }, [userAddress, chain?.id, uniswapRouterAddress, farmAddress, currentStaticPools, currentAddresses]);

  // === Read Contracts ===
  const { data: readResults, isLoading, refetch } = useReadContracts({
    contracts: contractsToRead,
    query: {
      enabled: !!userAddress && contractsToRead.length > 0,
      retry: 2, // Add retry for failed requests
    }
  });

  // Add state for farm data
  const [farmData, setFarmData] = useState<{
    currentRate: bigint | null;
    totalAllocPoint: bigint | null;
  }>({
    currentRate: null,
    totalAllocPoint: null
  });

  // === Process Farm Data Separate Effect ===
  useEffect(() => {
    if (!readResults || !contractsToRead) return;

    let newCurrentRate: bigint | null = null;
    let newTotalAllocPoint: bigint | null = null;

    readResults.forEach((result: any, index: number) => {
      if (index >= contractsToRead.length) return;
      const contractCall = contractsToRead[index];
      if (!contractCall || result.status === 'failure') return;

      // Directly check dataType for farm data
      if (contractCall.dataType === 'farmCurrentRate') {
        newCurrentRate = result.result as bigint | null;
      } else if (contractCall.dataType === 'farmTotalAllocPoint') {
        newTotalAllocPoint = result.result as bigint | null;
      }
      // --- Process stakingTokensOrder --- 
      else if (contractCall.dataType === 'stakingTokensOrder') {
        if (Array.isArray(result.result)) {
          const newOrder = result.result as Address[];
          // Update state only if order actually changed
          setStakingTokensOrder(prevOrder => {
            if (JSON.stringify(prevOrder) !== JSON.stringify(newOrder)) {
              console.log("LiquidityTab: Setting stakingTokensOrder:", newOrder);
              return newOrder;
            }
            return prevOrder;
          });
        }
      }
    });

    // Update state only if values changed
    setFarmData(prev => {
        if (prev.currentRate !== newCurrentRate || prev.totalAllocPoint !== newTotalAllocPoint) {
            return { currentRate: newCurrentRate, totalAllocPoint: newTotalAllocPoint };
        }
        return prev; // No change needed
    });

  }, [readResults, contractsToRead]); // Depend only on readResults and contractsToRead

  // === Process Results ===
  const poolsWithData: LiquidityPool[] = useMemo(() => {
    if (!readResults) {
      console.log("Raw readResults: undefined");
      return currentStaticPools.map(pool => ({
        ...pool,
        apr: null,
        userShare: null,
        reserve0Raw: null,
        reserve1Raw: null,
        token0Address: null,
        token1Address: null,
        userLpBalance: null,
        userToken1Balance: null,
        userToken2Balance: null,
        token1Allowance: null,
        token2Allowance: null,
        lpTokenAllowance: null,
      } as LiquidityPool));
    }
    
    console.log("Raw readResults:", readResults);
    
    const displayPoolDataMap = new Map<string, any>();
    
    // Initialize map keys for all pools AND pricing pairs
    currentStaticPools.forEach(pool => {
      displayPoolDataMap.set(pool.name, {});
    });
    
    // Also initialize any pricing pairs that might not be in the static pools list
    const pricingPairNames = ['SPARX/WETH LP', 'XBURN/WETH LP'];
    pricingPairNames.forEach(name => {
      if (!displayPoolDataMap.has(name)) {
        displayPoolDataMap.set(name, {});
      }
    });

    // Process contract read results
    readResults.forEach((result: any, index: number) => {
      if (index >= contractsToRead.length) return; // Safety check
      
      const contractCall = contractsToRead[index]; // Get the original call object
      if (!contractCall) return; // Should not happen if arrays align

      // Check for actual failure, allow 0n as a valid result
      if (result.status === 'failure' || (result.status === 'success' && result.result === undefined)) { 
          console.warn(`Contract call failed for index ${index}:`, result);
          return; 
      }
      
      // Now retrieve metadata from the original contractCall object
      const poolName = contractCall.poolName;
      const dataType = contractCall.dataType;

      if (!poolName) {
        // Skip farm-specific data - it's handled in the separate useEffect
        if (dataType === 'farmCurrentRate' || dataType === 'farmTotalAllocPoint') {
           return;
        }
        
        // If it's not farm data and has no poolName, log the warning
        console.warn(`Original contract call at index ${index} missing poolName and not farm-specific:`, contractCall);
        return;
      }
      
      // If it's farm data, skip - it's handled in the separate useEffect
      if (poolName === '__farm__') {
        return;
      }

      // Ensure the pool entry exists in the map
      if (!displayPoolDataMap.has(poolName)) {
        console.warn(`Pool name ${poolName} not found in displayPoolDataMap. This shouldn't happen.`);
        displayPoolDataMap.set(poolName, {});
      }
      const poolData = displayPoolDataMap.get(poolName);

      // --- Assign data based on dataType --- 
      switch (dataType) {
        // Remove farmData handling from here - it's now in the dedicated useEffect
        case 'displayPoolReserves':
        case 'pricingPairReserves': // Handle both regular and pricing pairs the same way
          if (Array.isArray(result.result) && result.result.length >= 2) {
            const [reserve0, reserve1] = result.result;
            poolData.reserve0Raw = reserve0;
            poolData.reserve1Raw = reserve1;
          } else {
            console.warn(`Unexpected result format for reserves at index ${index}:`, result.result);
          }
          break;
        case 'displayPoolToken0':
        case 'pricingPairToken0':
          poolData.token0Address = result.result;
          break;
        case 'displayPoolToken1':
        case 'pricingPairToken1':
          poolData.token1Address = result.result;
          break;
        case 'userLpBalance':
          poolData.userLpBalance = result.result;
          break;
        case 'userToken1Balance':
          poolData.userToken1Balance = result.result;
          break;
        case 'userToken2Balance':
          poolData.userToken2Balance = result.result;
          break;
        case 'token1Allowance':
          poolData.token1Allowance = result.result;
          break;
        case 'token2Allowance':
          poolData.token2Allowance = result.result;
          break;
        case 'lpTokenAllowance':
          poolData.lpTokenAllowance = result.result;
          break;
        case 'poolAllocPoint':
          // Handle different possible formats for poolInfo return value
          if (result.result?.allocPoint !== undefined) {
            poolData.allocPoint = result.result.allocPoint;
          } else if (Array.isArray(result.result) && result.result.length >= 1) {
            // Some contracts return an array where the first element is allocPoint
            poolData.allocPoint = result.result[0];
          } else {
            console.warn(`Unexpected result format for poolAllocPoint at index ${index}:`, result.result);
          }
          break;
        default:
          console.warn(`Unhandled dataType '${dataType}' at index ${index}`);
      }
    });

    console.log("Processed displayPoolDataMap:", displayPoolDataMap);

    const finalPools = currentStaticPools.map(pool => {
        const processedData = displayPoolDataMap.get(pool.name) ?? {};
        const reserve0Raw = processedData.reserve0Raw ?? null;
        const reserve1Raw = processedData.reserve1Raw ?? null;

        // Calculate user's share of the pool
        let userShare = 0;
        // Make sure reserves are not zero before dividing
        if (processedData.userLpBalance && reserve0Raw && reserve1Raw && (reserve0Raw + reserve1Raw) > 0n) {
          // Calculate total supply from reserves (approximation for UniswapV2 style)
          const lpTokenTotalSupplyApproximation = reserve0Raw + reserve1Raw; 
          const userLp = BigInt(processedData.userLpBalance);
          // Use BigInt for precision before converting to Number for percentage
          userShare = Number( (userLp * 10000n / lpTokenTotalSupplyApproximation) ) / 100; // *10000 / 100 for 2 decimal places
        }

        // Calculate APR if we have all required data
        let apr: number | null = null;
        const SECONDS_PER_YEAR = 31536000; // Use seconds per year
        
        if (farmData.currentRate && farmData.totalAllocPoint && processedData.allocPoint && farmData.totalAllocPoint > 0n) { // Check for currentRate
          try {
            const allocPoint = typeof processedData.allocPoint === 'bigint' 
              ? processedData.allocPoint 
              : BigInt(processedData.allocPoint || 0);
              
            if (allocPoint > 0n) {
              // Calculate rewards per second for the pool
              const poolRewardPerSecond = (farmData.currentRate * allocPoint) / farmData.totalAllocPoint;
              const yearlyRewardInSparxRaw = poolRewardPerSecond * BigInt(SECONDS_PER_YEAR);
              const yearlyRewardInSparx = parseFloat(formatUnits(yearlyRewardInSparxRaw, 18));
              
              // --- APR Calculation requires Pool Value --- 
              // Placeholder: APR calculation needs the total value of the LP pool.
              // For now, we'll set APR to null until pricing logic is fully integrated.
              // apr = (yearlyRewardInSparx * SPARX_PRICE / POOL_VALUE) * 100; 
              // console.log(`APR Calc: yearlyReward=${yearlyRewardInSparx}, poolValue=PLACEHOLDER`);
              apr = null; // Temporarily disable APR until pool value is available
            }
          } catch (error) {
            console.error("Error calculating APR:", error);
          }
        }

        const resultPool = {
          ...pool,
          apr: apr,
          userShare: userShare,
          reserve0Raw: reserve0Raw,
          reserve1Raw: reserve1Raw,
          token0Address: processedData.token0Address ?? null,
          token1Address: processedData.token1Address ?? null,
          userLpBalance: processedData.userLpBalance ?? null,
          userToken1Balance: processedData.userToken1Balance ?? null,
          userToken2Balance: processedData.userToken2Balance ?? null,
          token1Allowance: processedData.token1Allowance ?? null,
          token2Allowance: processedData.token2Allowance ?? null,
          lpTokenAllowance: processedData.lpTokenAllowance ?? null,
        } as LiquidityPool;
        console.log(`Final Pool Object [${pool.name}]:`, resultPool);
        return resultPool;
      });
      
      return finalPools;
    }, [readResults, currentStaticPools, farmData, contractsToRead]); // Note: keeping contractsToRead in dependencies

  // Explicitly sort the pools by PID before rendering to match Farm tab order
  const sortedPoolsForDisplay = useMemo(() => {
    // Sort based on index in stakingTokensOrder
    if (stakingTokensOrder.length === 0) {
        // Fallback: sort alphabetically by address if order not loaded
        return [...poolsWithData].sort((a, b) => a.address.localeCompare(b.address));
    }
    return [...poolsWithData].sort((a, b) => {
        const indexA = stakingTokensOrder.findIndex(addr => addr.toLowerCase() === a.address.toLowerCase());
        const indexB = stakingTokensOrder.findIndex(addr => addr.toLowerCase() === b.address.toLowerCase());
        // Pools not in farm order go last
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
    });
  }, [poolsWithData, stakingTokensOrder]); // Add stakingTokensOrder dependency

  return (
    <VStack align="stretch" spacing={6}>
      <Box>
        <Heading size="md" mb={2}>Liquidity Pools</Heading>
        <Text mb={4} color="gray.500">Provide liquidity to earn trading fees and SPARX rewards</Text>
      </Box>
      
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
        {/* Map over the explicitly sorted array */}
        {sortedPoolsForDisplay.map((pool) => (
          <PoolCard 
            key={pool.address}
            pool={pool}
            loading={isLoading}
            onSuccessfulTx={refetch}
          />
        ))}
      </SimpleGrid>
      
      {/* Liquidity Information Card */}
      <Card bg="#1a202c" borderColor="gray.700" variant="outline" mt={6} overflow="hidden">
        <CardBody p={6}>
          <VStack spacing={6} align="center">
            {/* Fox with Sunglasses Mascot */}
            <Box mb={2}>
              <Image 
                src="/sparx-shades.png" 
                alt="Sparx Fox with Sunglasses" 
                width="200px"
                height="200px"
                objectFit="contain"
              />
            </Box>
            
            {/* Information Sections - Side by Side */}
            <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={{ base: 6, md: 10 }} w="full" maxW="900px">
              {/* Liquidity Benefits Section */}
              <Box>
                <Flex align="center" mb={4}>
                  <Icon as={InfoIcon} color="#FF6937" boxSize={5} mr={2} />
                  <Heading size="md" color="#FF6937">Liquidity Provider Benefits</Heading>
                </Flex>
                
                <Text fontSize="md" color="gray.200" mb={4} pl={1}>
                  Providing liquidity has several advantages:
                </Text>
                
                <List spacing={3} pl={1}>
                  <ListItem color="gray.200" fontSize="md" display="flex">
                    <Text as="span" mr={2}>•</Text>
                    <Text>Earn 0.3% of all trading fees from swaps in the pool</Text>
                  </ListItem>
                  <ListItem color="gray.200" fontSize="md" display="flex">
                    <Text as="span" mr={2}>•</Text>
                    <Text>Stake LP tokens in farms for additional SPARX rewards</Text>
                  </ListItem>
                  <ListItem color="gray.200" fontSize="md" display="flex">
                    <Text as="span" mr={2}>•</Text>
                    <Text>Help increase token liquidity and reduce price impact</Text>
                  </ListItem>
                </List>
                
                <Text fontSize="md" color="gray.200" mt={4} pl={1}>
                  LP tokens represent your share of the pool and can be withdrawn anytime.
                </Text>
              </Box>
              
              {/* Impermanent Loss Section */}
              <Box>
                <Flex align="center" mb={4}>
                  <Icon as={WarningIcon} color="#38bdf8" boxSize={5} mr={2} />
                  <Heading size="md" color="#38bdf8">Understanding Risks</Heading>
                </Flex>
                
                <Text fontSize="md" color="gray.200" mb={4} pl={1}>
                  Important considerations for liquidity providers:
                </Text>
                
                <List spacing={3} pl={1}>
                  <ListItem color="gray.200" fontSize="md" display="flex">
                    <Text as="span" mr={2}>•</Text>
                    <Text>Impermanent loss may occur if token prices change significantly</Text>
                  </ListItem>
                  <ListItem color="gray.200" fontSize="md" display="flex">
                    <Text as="span" mr={2}>•</Text>
                    <Text>Always provide equal value of both tokens</Text>
                  </ListItem>
                  <ListItem color="gray.200" fontSize="md" display="flex">
                    <Text as="span" mr={2}>•</Text>
                    <Text>Higher trading volume means more fees earned</Text>
                  </ListItem>
                </List>
                
                <Text fontSize="md" color="gray.200" mt={4} pl={1}>
                  For maximum returns, stake your LP tokens in our farm pools.
                </Text>
              </Box>
            </Grid>
          </VStack>
        </CardBody>
      </Card>
    </VStack>
  )
}

export default LiquidityTab 