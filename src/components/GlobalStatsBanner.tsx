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
} from '@chakra-ui/react' 
import { useAccount, useReadContracts } from 'wagmi'
import { useMemo, useState, useEffect, useRef } from 'react'
import { getAddressesForChain, Addresses, isContractDeployed } from '../config/contracts'
import { getFarmPools, PoolInfo } from '../config/pools'
import sparxAbi from '../abis/SparxToken.json' with { type: 'json' }
import farmAbi from '../abis/SparxFarm.json' with { type: 'json' }
import erc20Abi from '../abis/ERC20.json' with { type: 'json' }
import { formatUnits, type Abi, zeroAddress, Address } from 'viem'
import { useCountdown } from '../hooks/useCountdown'

// const sparxAbiTyped = sparxAbi as Abi; // These seem unused now
// const farmAbiTyped = farmAbi as Abi;
const sparxAbiDirect = sparxAbi as Abi; // Use the imported json directly as abi
const farmAbiTyped = farmAbi as Abi; // Keep this one for farm reads

// Theme colors - REMOVE these, use theme directly
// const accentColor = 'orange.400';
// const yellowColor = 'yellow.400';

function formatLargeNumber(value: bigint | null | undefined, decimals = 18): string {
  if (value === null || typeof value === 'undefined') return '...';

  const num = parseFloat(formatUnits(value, decimals));

  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
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
  
  // Static Reads (Token Info, Burner Balance, Farm Info)
  const baseContractsToRead = useMemo(() => {
    const calls: any[] = [];
    
    if (sparxAddress !== zeroAddress && currentChainId) {
      // Fetch Total Supply
      calls.push({ address: sparxAddress, abi: sparxAbiDirect, functionName: 'totalSupply', chainId: currentChainId, dataType: 'sparxTotalSupply' });
      // Fetch Burned Amount (balance of zero address)
      calls.push({ address: sparxAddress, abi: sparxAbiDirect, functionName: 'balanceOf', args: [zeroAddress], chainId: currentChainId, dataType: 'sparxBurnedAmount' });

      if (burnerAddress !== zeroAddress) { // Check if burner is deployed
        calls.push({ address: sparxAddress, abi: sparxAbiDirect, functionName: 'balanceOf', args: [burnerAddress], chainId: currentChainId, dataType: 'burnerSparxBalance' });
      }
    }
    if (farmAddress !== zeroAddress && currentChainId) {
      calls.push({ address: farmAddress, abi: farmAbiTyped, functionName: 'poolLength', chainId: currentChainId, dataType: 'farmPoolLength' });
      calls.push({ address: farmAddress, abi: farmAbiTyped, functionName: 'getEmissionPhaseInfo', chainId: currentChainId, dataType: 'farmEmissionInfo' });
    }
    return calls;
  }, [sparxAddress, burnerAddress, farmAddress, currentChainId]);

  const { data: baseReadResults, isLoading: isLoadingBase } = useReadContracts({
    contracts: baseContractsToRead,
    query: { enabled: baseContractsToRead.length > 0 }
  });

  // Update poolCount when base data is loaded
  useEffect(() => {
      // Find the poolLength result directly
      const poolLengthCallIndex = baseContractsToRead.findIndex(c => c.dataType === 'farmPoolLength');
      let newPoolCount = 0;
      if (poolLengthCallIndex !== -1 && baseReadResults && baseReadResults[poolLengthCallIndex]?.status === 'success') {
          const resultValue = baseReadResults[poolLengthCallIndex].result;
          if (typeof resultValue === 'bigint') {
              newPoolCount = Number(resultValue);
          } else if (!isLoadingBase) {
              // If loading is finished and result wasn't bigint, assume 0
              newPoolCount = 0;
          } else {
              // Still loading or error, don't update count yet
              return;
          }
      } else if (!isLoadingBase && baseContractsToRead.some(c => c.dataType === 'farmPoolLength')) {
         // If loading is finished and the call existed but failed or wasn't found, assume 0
         newPoolCount = 0;
      }
      
      // Only update state if the count has actually changed
      setPoolCount(currentCount => {
          if (currentCount !== newPoolCount) {
              return newPoolCount;
          }
          return currentCount; // No change
      });

  // Simplify dependencies - baseContractsToRead reference might change unnecessarily
  }, [baseReadResults, isLoadingBase]);

  // Dynamic Reads (Pending Rewards for each pool)
  const pendingRewardsContracts = useMemo(() => {
    const calls: any[] = [];
    if (!userAddress || !isConnected || !chain || poolCount === 0 || farmAddress === zeroAddress) return [];

    for (let pid = 0; pid < poolCount; pid++) {
      calls.push({
          address: farmAddress,
          abi: farmAbiTyped,
          functionName: 'pendingRewards',
          args: [BigInt(pid), userAddress],
          chainId: chain.id,
          dataType: 'pendingReward'
      });
    }
    return calls;
  }, [userAddress, isConnected, chain, poolCount, farmAddress]);

  const { data: rewardsReadResults, isLoading: isLoadingRewards } = useReadContracts({
      contracts: pendingRewardsContracts,
      query: { enabled: isConnected && pendingRewardsContracts.length > 0 }
  });
  
  // Store contracts in a ref to prevent useEffect dependency loops
  const contractsToReadRef = useRef(baseContractsToRead);
  useEffect(() => {
      contractsToReadRef.current = baseContractsToRead;
  }, [baseContractsToRead]);

  // Process ALL base results and calculate derived values together
  const {
    burnerSparxBalance,
    farmEmissionInfo,
    totalPendingRewards,
    sparxTotalSupply,
    sparxBurnedAmount,
  } = useMemo(() => {
    let burnerBalance: bigint | null = null;
    let emissionInfo: any = null;
    let pending: bigint = 0n;
    let totalSupply: bigint | null = null;
    let burnedAmount: bigint | null = null;

    try {
      // Process base results
      baseReadResults?.forEach((result, index) => {
        if (result.status !== 'success') return;
        const call = contractsToReadRef.current[index]; 
        if (!call) return;

        switch (call.dataType) {
            case 'burnerSparxBalance':
                if (typeof result.result === 'bigint') burnerBalance = result.result;
                break;
            case 'farmEmissionInfo':
                emissionInfo = result.result;
                break;
            case 'sparxTotalSupply':
                 if (typeof result.result === 'bigint') totalSupply = result.result;
                break;
            case 'sparxBurnedAmount':
                 if (typeof result.result === 'bigint') burnedAmount = result.result;
                break;
            case 'farmPoolLength': 
                break;
            default:
                console.warn("Unhandled dataType in GlobalStatsBanner base results:", call.dataType);
        }
      });

      // Process reward results
      rewardsReadResults?.forEach(result => {
          if (result.status === 'success' && typeof result.result === 'bigint') {
              pending += result.result;
          }
      });
    } catch (error) {
      console.error('Error processing contract results:', error);
      return {
        burnerSparxBalance: null,
        farmEmissionInfo: null,
        totalPendingRewards: 0n,
        sparxTotalSupply: null,
        sparxBurnedAmount: null,
      };
    }

    return { 
      burnerSparxBalance: burnerBalance,
      farmEmissionInfo: emissionInfo,
      totalPendingRewards: pending,
      sparxTotalSupply: totalSupply,
      sparxBurnedAmount: burnedAmount,
    };
  }, [baseReadResults, rewardsReadResults]);

  // Calculate Circulating Supply AFTER processing results
  const circulatingSupply = useMemo(() => {
      if (sparxTotalSupply !== null && burnerSparxBalance !== null) {
          // Simple calc: Total Supply - Burner Contract Balance
          // A more complex calculation might subtract other locked/non-circulating balances
          return sparxTotalSupply - burnerSparxBalance;
      }
      return null; // Return null if required data isn't available
  }, [sparxTotalSupply, burnerSparxBalance]);

  // --- Derived Stats ---
  const currentPhaseEnd = farmEmissionInfo && Array.isArray(farmEmissionInfo) && farmEmissionInfo.length > 1 
    ? farmEmissionInfo[1] as bigint 
    : undefined;
  const phaseEndTimer = useCountdown(currentPhaseEnd);

  // Use the fetched burned amount directly
  const totalBurned = sparxBurnedAmount; 

  // Combine loading states
  const isLoading = isLoadingBase || isLoadingRewards;

  return (
    <Box bg='gray.700' borderRadius="xl" p={5} mb={6} boxShadow="md"> {/* Use theme color */}
      <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} spacing={5}>
        {/* REMOVED SPARX Supply */}
        {/* 
        <Stat>
          <StatLabel color={textColor}>SPARX Supply</StatLabel>
          <StatNumber color={headingColor}>{isLoading && currentSparxSupply === null ? <Skeleton height="24px" width="100px" /> : formatLargeNumber(currentSparxSupply)}</StatNumber>
          <StatHelpText color={textColor}>Max: {formatLargeNumber(maxSparxSupply)}</StatHelpText>
        </Stat>
        */}
         {/* Circulating Supply (Est.) */}
        <Stat>
          <StatLabel color='gray.300'>Circulating Supply (Est.)</StatLabel> {/* Use theme color */}
          <StatNumber color='brand.500'> {/* Use new theme brand color */}
            {isLoading && circulatingSupply === null ? (
              <Skeleton height="24px" width="100px" />
            ) : (
              circulatingSupply === null ? 'Calculating...' : formatLargeNumber(circulatingSupply)
            )}
          </StatNumber>
          <StatHelpText color='gray.300'>Total - Burner Balance</StatHelpText> {/* Use theme color */}
        </Stat>
         {/* Reward Phase End */}
        <Stat>
            <StatLabel color='gray.300'>Reward Phase Ends In</StatLabel> {/* Use theme color */}
             <Skeleton isLoaded={!isLoading && Boolean(currentPhaseEnd)} minHeight="24px">
                <StatNumber color='brand.500'> {/* Use new theme brand color */}
                     {phaseEndTimer === 'Ready' ? 'Ended' : phaseEndTimer}
                </StatNumber>
            </Skeleton>
             <StatHelpText color='gray.300'>Current Emission Phase</StatHelpText> {/* Use theme color */}
        </Stat>
         {/* User Pending Rewards */}
        <Stat>
          <StatLabel color='gray.300'>Your Pending Rewards</StatLabel> {/* Use theme color */}
          <StatNumber color='yellow.400'> {/* Keep yellow for this stat */}
            {isLoading && totalPendingRewards === 0n && isConnected ? <Skeleton height="24px" width="80px" /> : 
             !isConnected ? 'Connect Wallet' : 
             `${formatLargeNumber(totalPendingRewards)} SPARX`}
          </StatNumber>
          <StatHelpText color='gray.300'>From All Farm Pools</StatHelpText> {/* Use theme color */}
        </Stat>
         {/* Total Burned */}
        <Stat>
          <StatLabel color='gray.300'>Total SPARX Burned</StatLabel>
          <StatNumber color='brand.500'> {/* Use new theme brand color */}
            {isLoading || totalBurned === null ? (
              <Skeleton height="24px" width="100px" />
            ) : (
              formatLargeNumber(totalBurned, 18) 
            )}
          </StatNumber>
          <StatHelpText color='gray.300'>SPARX</StatHelpText>
        </Stat>
      </SimpleGrid>
    </Box>
  )
}

export default GlobalStatsBanner 