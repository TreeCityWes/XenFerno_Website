import {
  Flex, 
  Stat, 
  StatLabel, 
  StatNumber, 
  StatHelpText, 
  useColorModeValue, 
  Skeleton, 
  SimpleGrid,
  Box,
  Tooltip,
  Icon,
} from '@chakra-ui/react' 
import { useAccount, useReadContracts } from 'wagmi'
import { useMemo, useState, useEffect, useRef } from 'react'
import { getAddressesForChain, Addresses, isContractDeployed } from '../config/contracts'
import { getFarmPools, PoolInfo } from '../config/pools'
import sparxAbi from '../abis/SparxToken.json' with { type: 'json' }
import farmAbi from '../abis/SparxFarm.json' with { type: 'json' }
import erc20Abi from '../abis/ERC20.json' with { type: 'json' }
import burnerAbi from '../abis/SparxBurner.json' with { type: 'json' }
import { formatUnits, type Abi, zeroAddress, Address } from 'viem'
import { useCountdown } from '../hooks/useCountdown'

// const sparxAbiTyped = sparxAbi as Abi; // These seem unused now
// const farmAbiTyped = farmAbi as Abi;
const sparxAbiDirect = sparxAbi as Abi; // Use the imported json directly as abi
const farmAbiTyped = farmAbi as Abi; // Use V2 ABI
const burnerAbiTyped = burnerAbi as Abi; // Use the burner ABI

// Theme colors - REMOVE these, use theme directly
// const accentColor = 'orange.400';
// const yellowColor = 'yellow.400';

// Placeholder Prices
const PLACEHOLDER_PRICES = {
  SPARX: 0.05,
  XBURN: 0.12,
  XEN: 0.00000015 // Example price for XEN
};

function formatLargeNumber(value: bigint | number | null | undefined, inputDecimals = 18): string {
  if (value === null || typeof value === 'undefined') return '...';
  let num: number;
  if (typeof value === 'bigint') {
    num = parseFloat(formatUnits(value, inputDecimals));
  } else {
    num = value;
  }

  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  // Don't use K for values below 1M, show exact value
  // if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K'; 
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || typeof value === 'undefined') return '...';
  // Use maximumFractionDigits for small prices like XEN
  const options: Intl.NumberFormatOptions = { 
    style: 'currency', 
    currency: 'USD', 
    maximumFractionDigits: value < 0.001 ? 8 : 4 
  };
  return value.toLocaleString('en-US', options);
}

function GlobalStatsBanner() {
  const { address: userAddress, isConnected, chain } = useAccount();
  // Remove local color definitions - rely on theme
  // const bg = useColorModeValue('orange.100', 'gray.700');
  // const headingColor = useColorModeValue('orange.800', accentColor);
  // const textColor = useColorModeValue('gray.600', 'gray.300');
  
  const currentAddresses = useMemo(() => getAddressesForChain(chain?.id), [chain?.id]);
  const currentFarmPools = useMemo(() => getFarmPools(currentAddresses), [currentAddresses]);
  const farmAddress = useMemo(() => {
      const farmAddr = currentAddresses.farm;
      return farmAddr && isContractDeployed(farmAddr) ? farmAddr as Address : zeroAddress;
  }, [currentAddresses]);
  const burnerAddress = useMemo(() => {
      const burnerAddr = currentAddresses.burner;
      return burnerAddr && isContractDeployed(burnerAddr) ? burnerAddr as Address : zeroAddress;
  }, [currentAddresses]);
  const currentChainId = chain?.id;
  const sparxAddress = useMemo(() => {
      const addr = currentAddresses.sparx;
      return addr && isContractDeployed(addr) ? addr as Address : zeroAddress;
  }, [currentAddresses]);

  // State for pool count needed for pending rewards
  const [poolCount, setPoolCount] = useState<number>(0);

  // --- Contract Reads --- 
  
  // Static Reads (Token Info, Burner Balance, Farm Info, Farm Rate)
  const baseContractsToRead = useMemo(() => {
    const calls: any[] = [];
    
    if (sparxAddress !== zeroAddress && currentChainId) {
      // Get current supply
      calls.push({ address: sparxAddress, abi: sparxAbiDirect, functionName: 'totalSupply', chainId: currentChainId, dataType: 'sparxTotalSupply' });
      // Get cap
      calls.push({ address: sparxAddress, abi: sparxAbiDirect, functionName: 'CAP', chainId: currentChainId, dataType: 'sparxCap' });
      
      // Use the dedicated burn tracking function
      calls.push({ address: sparxAddress, abi: sparxAbiDirect, functionName: 'getTotalBurned', chainId: currentChainId, dataType: 'sparxTotalBurned' });
      
      if (burnerAddress !== zeroAddress) {
        calls.push({ address: sparxAddress, abi: sparxAbiDirect, functionName: 'balanceOf', args: [burnerAddress], chainId: currentChainId, dataType: 'burnerSparxBalance' });
        
        // Also get burns tracked by the burner contract
        calls.push({ address: burnerAddress, abi: burnerAbiTyped, functionName: 'getTotalSparxBurned', chainId: currentChainId, dataType: 'burnerSparxBurned' });
      }
    }
    if (farmAddress !== zeroAddress && currentChainId) {
      calls.push({ address: farmAddress, abi: farmAbiTyped, functionName: 'poolLength', chainId: currentChainId, dataType: 'farmPoolLength' });
      calls.push({ address: farmAddress, abi: farmAbiTyped, functionName: 'getEmissionPhaseInfo', chainId: currentChainId, dataType: 'farmEmissionInfo' });
      calls.push({ address: farmAddress, abi: farmAbiTyped, functionName: 'currentRate', chainId: currentChainId, dataType: 'farmCurrentRate' });
    }
    return calls;
  }, [sparxAddress, burnerAddress, farmAddress, currentChainId]);

  const { data: baseReadResults, isLoading: isLoadingBase } = useReadContracts({
    contracts: baseContractsToRead,
    query: { enabled: baseContractsToRead.length > 0 }
  });

  // Update poolCount when base data is loaded
  useEffect(() => {
      const poolLengthCallIndex = baseContractsToRead.findIndex(c => c.dataType === 'farmPoolLength');
      let newPoolCount = 0;
      if (poolLengthCallIndex !== -1 && baseReadResults && baseReadResults[poolLengthCallIndex]?.status === 'success') {
          const resultValue = baseReadResults[poolLengthCallIndex].result;
          if (typeof resultValue === 'bigint') {
              newPoolCount = Number(resultValue);
          }
      }
      setPoolCount(newPoolCount);
  }, [baseReadResults, baseContractsToRead]); // Re-run if baseContractsToRead changes (e.g., chain switch)

  // Dynamic Reads (Pending Rewards + PoolInfo for each pool)
  const dynamicContracts = useMemo(() => {
    const calls: any[] = [];
    if (!chain || poolCount === 0 || farmAddress === zeroAddress) return [];

    for (let pid = 0; pid < poolCount; pid++) {
      if (userAddress && isConnected) { // Only fetch rewards if connected
          calls.push({
              address: farmAddress,
              abi: farmAbiTyped,
              functionName: 'pendingRewards',
              args: [BigInt(pid), userAddress],
              chainId: chain.id,
              dataType: 'pendingReward',
              pid: pid
          });
      }
      // Always fetch poolInfo
      calls.push({
          address: farmAddress,
          abi: farmAbiTyped,
          functionName: 'poolInfo',
          args: [BigInt(pid)],
          chainId: chain.id,
          dataType: 'poolInfo',
          pid: pid
      });
    }
    return calls;
  }, [userAddress, isConnected, chain, poolCount, farmAddress]);

  const { data: dynamicReadResults, isLoading: isLoadingDynamic } = useReadContracts({
      contracts: dynamicContracts,
      query: { enabled: dynamicContracts.length > 0 }
  });
  
  // Store contracts in refs to prevent useEffect dependency loops
  const baseContractsRef = useRef(baseContractsToRead);
  const dynamicContractsRef = useRef(dynamicContracts);
  useEffect(() => { baseContractsRef.current = baseContractsToRead; }, [baseContractsToRead]);
  useEffect(() => { dynamicContractsRef.current = dynamicContracts; }, [dynamicContracts]);

  // Process ALL results and calculate derived values together
  const {
    burnerSparxBalance,
    farmEmissionInfo,
    farmCurrentRate,
    totalPendingRewards,
    sparxTotalSupply,
    sparxCap,
    sparxBurnedAmount,
    burnerSparxBurned
  } = useMemo(() => {
    let burnerBalance: bigint | null = null;
    let emissionInfo: any = null;
    let currentRate: bigint | null = null;
    let pending: bigint = 0n;
    let totalSupply: bigint | null = null;
    let cap: bigint | null = null;
    let burned: bigint | null = null;
    let burnerBurned: bigint | null = null;

    try {
      // Process base results
      baseReadResults?.forEach((result, index) => {
        if (result.status !== 'success') return;
        const call = baseContractsRef.current[index]; 
        if (!call) return;

        switch (call.dataType) {
            case 'burnerSparxBalance':
                if (typeof result.result === 'bigint') burnerBalance = result.result;
                break;
            case 'farmEmissionInfo':
                emissionInfo = result.result;
                break;
            case 'farmCurrentRate':
                if (typeof result.result === 'bigint') currentRate = result.result;
                break;
            case 'sparxTotalSupply':
                if (typeof result.result === 'bigint') totalSupply = result.result;
                break;
            case 'sparxCap':
                if (typeof result.result === 'bigint') cap = result.result;
                break;
            case 'sparxTotalBurned':
                if (typeof result.result === 'bigint') burned = result.result;
                console.log('Total SPARX burned from token contract:', burned ? formatUnits(burned, 18) : '0');
                break;
            case 'burnerSparxBurned':
                if (typeof result.result === 'bigint') burnerBurned = result.result;
                console.log('Total SPARX burned from burner contract:', burnerBurned ? formatUnits(burnerBurned, 18) : '0');
                break;
            case 'farmPoolLength': 
                break;
            default:
                console.warn("Unhandled dataType in GlobalStatsBanner base results:", call.dataType);
        }
      });

      // Process dynamic results (rewards and poolInfo)
      dynamicReadResults?.forEach((result, index) => {
        if (result.status !== 'success') return;
        const call = dynamicContractsRef.current[index];
        if (!call) return;

        if (call.dataType === 'pendingReward' && typeof result.result === 'bigint') {
            pending += result.result;
        }
      });
      
      // Log for debugging
      console.log('Total Supply:', totalSupply ? formatUnits(totalSupply, 18) : '0');
      console.log('Cap:', cap ? formatUnits(cap, 18) : '0');
      
    } catch (error) {
      console.error('Error processing contract results:', error);
      // Return defaults on error
      return { 
        burnerSparxBalance: null,
        farmEmissionInfo: null,
        farmCurrentRate: null,
        totalPendingRewards: 0n,
        sparxTotalSupply: null,
        sparxCap: null,
        sparxBurnedAmount: null,
        burnerSparxBurned: null
      };
    }

    return { 
      burnerSparxBalance: burnerBalance,
      farmEmissionInfo: emissionInfo,
      farmCurrentRate: currentRate,
      totalPendingRewards: pending,
      sparxTotalSupply: totalSupply,
      sparxCap: cap,
      sparxBurnedAmount: burned,
      burnerSparxBurned: burnerBurned
    };
  }, [baseReadResults, dynamicReadResults]);

  // --- Derived Stats ---
  const currentPhaseEnd = farmEmissionInfo && Array.isArray(farmEmissionInfo) && farmEmissionInfo.length > 1 
    ? farmEmissionInfo[1] as bigint 
    : undefined;
  const phaseEndTimer = useCountdown(currentPhaseEnd);
  
  const emissionRatePerDay = useMemo(() => {
      if (farmCurrentRate === null) return null;
      return farmCurrentRate * 86400n; // Rate per second * seconds per day
  }, [farmCurrentRate]);

  const totalSupplyPercentage = useMemo(() => {
      if (sparxTotalSupply === null || sparxCap === null || sparxCap === 0n) return null;
      return Number((sparxTotalSupply * 10000n) / sparxCap) / 100;
  }, [sparxTotalSupply, sparxCap]);

  // Combine loading states
  const isLoading = isLoadingBase || isLoadingDynamic;

  return (
    <Box 
      bg='gray.800' 
      borderRadius="xl" 
      p={5} 
      mb={6} 
      boxShadow="md"
      borderWidth="1px"
      borderColor="gray.700"
    > 
      <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} spacing={5}>
        {/* SPARX Price Placeholder */}
        <Stat 
          bg="gray.700" 
          p={3} 
          borderRadius="md" 
          boxShadow="sm"
          transition="all 0.2s"
          _hover={{ transform: 'translateY(-2px)', boxShadow: 'md' }}
        >
          <StatLabel color='gray.300'>SPARX Price</StatLabel>
          <StatNumber color='yellow.400'>
            {formatPrice(PLACEHOLDER_PRICES.SPARX)}
          </StatNumber>
          <StatHelpText color='gray.400'>Testnet Placeholder</StatHelpText>
        </Stat>
        {/* XBURN Price Placeholder */}
        <Stat 
          bg="gray.700" 
          p={3} 
          borderRadius="md" 
          boxShadow="sm"
          transition="all 0.2s"
          _hover={{ transform: 'translateY(-2px)', boxShadow: 'md' }}
        >
          <StatLabel color='gray.300'>XBURN Price</StatLabel>
          <StatNumber color='red.400'>
            {formatPrice(PLACEHOLDER_PRICES.XBURN)}
          </StatNumber>
          <StatHelpText color='gray.400'>Testnet Placeholder</StatHelpText>
        </Stat>
        {/* XEN Price Placeholder */}
        <Stat 
          bg="gray.700" 
          p={3} 
          borderRadius="md" 
          boxShadow="sm"
          transition="all 0.2s"
          _hover={{ transform: 'translateY(-2px)', boxShadow: 'md' }}
        >
          <StatLabel color='gray.300'>XEN Price</StatLabel>
          <StatNumber color='blue.400'>
             {formatPrice(PLACEHOLDER_PRICES.XEN)}
          </StatNumber>
          <StatHelpText color='gray.400'>Testnet Placeholder</StatHelpText>
        </Stat>
        {/* User Pending Rewards */}
        <Stat 
          bg="gray.700" 
          p={3} 
          borderRadius="md" 
          boxShadow="sm"
          transition="all 0.2s"
          _hover={{ transform: 'translateY(-2px)', boxShadow: 'md' }}
        >
          <StatLabel color='gray.300'>Your Pending Rewards</StatLabel>
          <StatNumber color='yellow.400'>
            {isLoading && totalPendingRewards === 0n && isConnected ? <Skeleton height="24px" width="80px" /> : 
             !isConnected ? 'Connect Wallet' : 
             `${formatLargeNumber(totalPendingRewards)} SPARX`}
          </StatNumber>
          <StatHelpText color='gray.300'>From All Farm Pools</StatHelpText>
        </Stat>
        {/* Ready to Ignite */}
        <Stat 
          bg="gray.700" 
          p={3} 
          borderRadius="md" 
          boxShadow="sm"
          transition="all 0.2s"
          _hover={{ transform: 'translateY(-2px)', boxShadow: 'md' }}
        >
          <StatLabel color='gray.300'>Ready to Ignite</StatLabel>
           <Tooltip label="SPARX accumulated in the Burner contract, ready for the buy-and-burn mechanism." placement="top" hasArrow bg="gray.800">
                <StatNumber color='orange.400'>
                    {isLoading && burnerSparxBalance === null ? (
                    <Skeleton height="24px" width="90px" />
                    ) : (
                    burnerSparxBalance === null ? '...' : `${formatLargeNumber(burnerSparxBalance)} SPARX`
                    )}
                </StatNumber>
          </Tooltip>
          <StatHelpText color='gray.300'>SPARX in Burner Vault</StatHelpText>
        </Stat>
        {/* Emission Rate */}
        <Stat 
          bg="gray.700" 
          p={3} 
          borderRadius="md" 
          boxShadow="sm"
          transition="all 0.2s"
          _hover={{ transform: 'translateY(-2px)', boxShadow: 'md' }}
        >
          <StatLabel color='gray.300'>Emission Rate</StatLabel>
          <StatNumber color='orange.400'>
            {isLoading && emissionRatePerDay === null ? (
              <Skeleton height="24px" width="120px" />
            ) : (
              emissionRatePerDay === null ? '...' : `${formatLargeNumber(emissionRatePerDay)} SPARX/day`
            )}
          </StatNumber>
          <StatHelpText color='gray.300'>Current Farm Rewards</StatHelpText>
        </Stat>
        {/* Total Burned SPARX - Re-added */}
        <Stat 
          bg="gray.700" 
          p={3} 
          borderRadius="md" 
          boxShadow="sm"
          transition="all 0.2s"
          _hover={{ transform: 'translateY(-2px)', boxShadow: 'md' }}
        >
          <StatLabel color='gray.300'>Total SPARX Burned</StatLabel>
          <StatNumber color='red.400'>
            {isLoading || sparxBurnedAmount === null ? (
              formatLargeNumber(0n, 18)
            ) : (
              formatLargeNumber(sparxBurnedAmount, 18)
            )}
          </StatNumber>
          <StatHelpText color='gray.300'>Total Tokens Burned</StatHelpText>
        </Stat>
        {/* Total Supply / Cap */}
        <Stat 
          bg="gray.700" 
          p={3} 
          borderRadius="md" 
          boxShadow="sm"
          transition="all 0.2s"
          _hover={{ transform: 'translateY(-2px)', boxShadow: 'md' }}
        >
          <StatLabel color='gray.300'>Total Supply</StatLabel>
          <StatNumber color='blue.400'>
            {isLoading && (sparxTotalSupply === null || sparxCap === null) ? (
              <Skeleton height="24px" width="100px" />
            ) : (
              sparxTotalSupply === null || sparxCap === null ? '...' : 
              `${formatLargeNumber(sparxTotalSupply)} / ${formatLargeNumber(sparxCap)}`
            )}
          </StatNumber>
          <StatHelpText color='gray.300'>
            {totalSupplyPercentage !== null ? `${totalSupplyPercentage.toFixed(2)}% of Cap` : '...'}
          </StatHelpText>
        </Stat>
      </SimpleGrid>
    </Box>
  )
}

export default GlobalStatsBanner 