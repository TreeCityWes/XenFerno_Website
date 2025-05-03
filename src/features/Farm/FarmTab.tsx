import { Box, VStack, Heading, Text, SimpleGrid, Alert, AlertIcon, AlertTitle, Center, Spinner, Card, CardBody, Flex, Icon, HStack, Image, Grid, List, ListItem } from '@chakra-ui/react'
import { useMemo, useEffect, useState } from 'react'
import { FarmPoolCard } from './FarmPoolCard'
import { useAccount, useReadContracts } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { getAddressesForChain, Addresses, isContractDeployed } from '../../config/contracts'
import { type Abi, zeroAddress, formatUnits, Address } from 'viem'
import farmAbi from '../../abis/SparxFarm.json' with { type: 'json' }
import erc20Abi from '../../abis/ERC20.json' with { type: 'json' }
import { mapLpAddressToInfo } from '../../utils/poolUtils'
import { LockIcon, TimeIcon, InfoIcon } from '@chakra-ui/icons'

// Type ABIs
const farmAbiTyped = farmAbi as Abi;
const erc20AbiTyped = erc20Abi as Abi;

// Export FarmStatsData interface for use in other components
export interface FarmStatsData {
    currentRate?: bigint;
    currentPhaseEnd?: bigint;
    secondsRemaining?: bigint;
    farmCap?: bigint;
    farmMinted?: bigint;
    depositsEnabled?: boolean;
    hasNewFarm?: boolean;
    currentPhaseIndex?: number;
    percentComplete?: number;
}

// Minimal ABI for Uniswap V2 Pair functions needed
const uniswapV2PairAbi = [
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint112', name: '_reserve0' }, { type: 'uint112', name: '_reserve1' }, { type: 'uint32', name: '_blockTimestampLast' }] }
] as const;

// Define PoolInfo based on contract return (poolInfo(pid))
export interface PoolInfoContract {
  lp: `0x${string}`;
  allocPoint: bigint;
  lastRewardTimestamp: bigint;
  accSparxPerShare: bigint;
  supply: bigint;
}

// Updated PoolInfo for internal use, mapping addresses to names
export interface PoolInfoInternal {
  pid: number;
  lpAddress: `0x${string}`;
  name: string;
  token1Symbol: string;
  token2Symbol: string;
  isSingleSided: boolean;
  allocPoint: bigint;
  supply?: bigint;
}

// Define the structure for combined data passed to the card
export interface FarmPoolCardData {
  poolInfo: PoolInfoInternal;
  walletBalance: bigint | null;
  allowance: bigint | null;
  pendingRewards: bigint | null;
  stakedBalance: bigint | null;
  lpTotalSupply: bigint | null;
  lpReserves: { reserve0: bigint, reserve1: bigint } | null;
  distributionShare: bigint | null;
  userInfo: {
    rewardDebt: bigint;
    lastActionTimestamp: bigint;
    lastActionBlock: bigint;
    lastWithdrawTimestamp: bigint;
    actionsInBlock: bigint;
    unlockTimestamp: bigint;
  } | null;
  lockInfo: {
    lockDuration: bigint;
    bonusMultiplier: bigint;
    userUnlockTimestamp: bigint;
    secondsRemaining: bigint;
  } | null;
  cooldownInfo?: {
    lastActionTimestamp: bigint;
    lastWithdrawTimestamp: bigint;
    cooldownEnds: bigint;
    withdrawCooldownEnds: bigint;
    isCooldownActive: boolean;
    isWithdrawCooldownActive: boolean;
  } | null;
}

// Define props for the tab component
interface TabProps {
  isActive: boolean;
}

// Removed mapLpAddressToInfo - now imported from utils
/*
function mapLpAddressToInfo(lpAddress: `0x${string}`, addresses: Addresses): Omit<PoolInfoInternal, 'pid' | 'lpAddress' | 'allocPoint'> {
  // ... function implementation ...
}
*/

function FarmTab({ isActive }: TabProps) {
  const { address: userAddress, isConnected, chain } = useAccount();
  const [poolCount, setPoolCount] = useState<number>(0);
  const [processedFarmData, setProcessedFarmData] = useState<FarmPoolCardData[]>([]);
  const [userDataCalls, setUserDataCalls] = useState<any[]>([]);
  const [dataMap, setDataMap] = useState<Map<number, Partial<FarmPoolCardData>>>(new Map());
  const [rawDistributionInfo, setRawDistributionInfo] = useState<any>(null);
  const [farmStats, setFarmStats] = useState<FarmStatsData | null>(null);

  const currentAddresses = useMemo(() => getAddressesForChain(chain?.id), [chain?.id]);
  const farmAddress = useMemo(() => {
      const addr = currentAddresses.farm;
      return addr && isContractDeployed(addr) ? addr as `0x${string}` : zeroAddress;
  }, [currentAddresses]);

  // === Static Contract Calls (Aggregated Farm/Pool Info) ===
  const staticContracts = useMemo(() => {
    if (!isConnected || !chain || !isContractDeployed(farmAddress)) return [];
    return [
      { address: farmAddress, abi: farmAbiTyped, functionName: 'poolLength', chainId: chain.id },
      { address: farmAddress, abi: farmAbiTyped, functionName: 'getPoolDistributionInfo', chainId: chain.id },
      { address: farmAddress, abi: farmAbiTyped, functionName: 'getFarmInfo', chainId: chain.id },
      { address: farmAddress, abi: farmAbiTyped, functionName: 'getEmissionPhaseInfo', chainId: chain.id },
    ];
  }, [isConnected, chain?.id, farmAddress]);

  const { data: staticResults, isLoading: isLoadingStatic, error: staticError, refetch: refetchStatic } = useReadContracts({
    contracts: staticContracts,
    query: { enabled: isConnected && staticContracts.length > 0 && farmAddress !== zeroAddress },
  });

  // Process static results (Farm Info, Emission Info, Distribution Info)
  useEffect(() => {
    if (!staticResults) return;

    let newPoolCount = 0;
    let newFarmStats: Partial<FarmStatsData> = {};
    let newDistributionInfo: any = null;

    staticResults.forEach((result, index) => {
      if (result.status !== 'success') {
        console.error(`Static contract call failed at index ${index}:`, result.error || 'Unknown error');
        return;
      }

      switch (index) {
        case 0: // poolLength
          newPoolCount = Number(result.result);
          console.log(`Processing poolLength: ${newPoolCount}`);
          break;
        case 1: // getPoolDistributionInfo
          if (Array.isArray(result.result) && result.result.length > 0) {
            console.log("Processing pool distribution info:", result.result);
            newDistributionInfo = {
              count: result.result[0] as bigint,
              addresses: result.result[1] as Address[],
              allocPoints: result.result[2] as bigint[],
              supplies: result.result[3] as bigint[],
              shares: result.result[4] as bigint[],
            };
          } else {
            console.error("Invalid pool distribution info format:", result.result);
          }
          break;
        case 2: // getFarmInfo - New V2 function
          if (result.result && typeof result.result === 'object') {
            console.log("Processing farm info:", result.result);
            const farmInfo = result.result as any;
            newFarmStats = {
              ...newFarmStats,
              farmCap: farmInfo.farmCap || 0n,
              farmMinted: farmInfo.minted || 0n,
              currentRate: farmInfo.currentEmissionRate || 0n,
              depositsEnabled: farmInfo.isDepositsEnabled ?? true,
              hasNewFarm: farmInfo.hasNewFarm ?? false
            };
          } else {
            console.error("Invalid farm info format:", result.result);
          }
          break;
        case 3: // getEmissionPhaseInfo - New V2 function
          if (result.result && typeof result.result === 'object') {
            console.log("Processing emission phase info:", result.result);
            const phaseInfo = result.result as any;
            newFarmStats = {
              ...newFarmStats,
              currentPhaseIndex: Number(phaseInfo.currentPhaseIndex) || 0,
              currentPhaseEnd: phaseInfo.currentPhaseEnd || 0n,
              secondsRemaining: phaseInfo.secondsRemaining || 0n,
              percentComplete: Number(phaseInfo.percentComplete) || 0
            };
          } else {
            console.error("Invalid emission phase info format:", result.result);
          }
          break;
      }
    });

    setPoolCount(newPoolCount);
    setFarmStats((prev: FarmStatsData | null) => ({ ...(prev || {}), ...newFarmStats }) as FarmStatsData);
    setRawDistributionInfo(newDistributionInfo);
    
    console.log("Updated farm stats:", newFarmStats);
    console.log("Updated distribution info:", newDistributionInfo);
  }, [staticResults, staticContracts]);

  // === Derive Pool Structures and Setup User Data Calls ===
  const derivedPools = useMemo(() => {
    if (!rawDistributionInfo) return [];
    
    const pools: PoolInfoInternal[] = [];
    const addresses = rawDistributionInfo.addresses;
    const newDataMap = new Map<number, Partial<FarmPoolCardData>>();
    console.log("FarmTab: Processing rawDistributionInfo:", rawDistributionInfo);
    console.log("FarmTab: Allowed LP/Staking Farm addresses for filtering:", addresses);
    
    // Process each pool
    for (let pid = 0; pid < addresses.length; pid++) {
      const lpAddress = addresses[pid] as Address;
      const allocPoint = rawDistributionInfo.allocPoints[pid] as bigint;
      const supply = rawDistributionInfo.supplies[pid] as bigint;
      const share = rawDistributionInfo.shares[pid] as bigint;
      
      // Get pool info from the utility function
      const poolInfo = mapLpAddressToInfo(lpAddress, currentAddresses);
      
      // Only include non-single-sided pools (LP tokens)
      if (!poolInfo.isSingleSided) {
        console.log(`FarmTab: PID ${pid} PASSED filter. LP Address: ${lpAddress}`);
        
        const internalPoolInfo: PoolInfoInternal = {
          pid,
          lpAddress,
          allocPoint,
          ...poolInfo
        };
        
        pools.push(internalPoolInfo);
        
        // Initialize data map entry
        newDataMap.set(pid, { 
          poolInfo: internalPoolInfo,
          distributionShare: share,
          walletBalance: null,
          allowance: null,
          pendingRewards: null,
          stakedBalance: null,
          lpTotalSupply: null,
          lpReserves: null,
          userInfo: null,
          lockInfo: null,
        });
      } else {
        console.log(`FarmTab: PID ${pid} FILTERED OUT - single-sided staking.`);
      }
    }
    
    // Update the data map state
    setDataMap(newDataMap);
    
    // Setup user data calls for these pools
    if (userAddress && isConnected && chain && farmAddress !== zeroAddress) {
      const newUserCalls: any[] = [];
      
      for (const pool of pools) {
        const lpAddress = pool.lpAddress;
        const pid = pool.pid;
        
        if (isContractDeployed(lpAddress)) {
          // Add wallet balance call
          newUserCalls.push({
            address: lpAddress, abi: erc20AbiTyped, functionName: 'balanceOf',
            args: [userAddress], chainId: chain.id, poolPid: pid, dataType: 'walletBalance'
          });
          
          // Add allowance call
          newUserCalls.push({
            address: lpAddress, abi: erc20AbiTyped, functionName: 'allowance',
            args: [userAddress, farmAddress], chainId: chain.id, poolPid: pid, dataType: 'allowance'
          });
          
          // Add pending rewards call
          newUserCalls.push({
            address: farmAddress, abi: farmAbiTyped, functionName: 'pendingRewards',
            args: [BigInt(pid), userAddress], chainId: chain.id, poolPid: pid, dataType: 'pendingRewards'
          });
          
          // Add user info call
          newUserCalls.push({
            address: farmAddress, abi: farmAbiTyped, functionName: 'getUserInfo',
            args: [BigInt(pid), userAddress], chainId: chain.id, poolPid: pid, dataType: 'userInfoFetch'
          });
          
          // Add lock info call - Use getUserStakeInfo instead of getUserLockInfo
          newUserCalls.push({
            address: farmAddress, abi: farmAbiTyped, functionName: 'getUserStakeInfo',
            args: [BigInt(pid), userAddress], chainId: chain.id, poolPid: pid, dataType: 'lockInfoFetch'
          });
          
          // For LP tokens, get additional data
          if (!pool.isSingleSided) {
            newUserCalls.push({
              address: lpAddress, abi: uniswapV2PairAbi, functionName: 'totalSupply',
              args: [], chainId: chain.id, poolPid: pid, dataType: 'lpTotalSupply'
            });
            newUserCalls.push({
              address: lpAddress, abi: uniswapV2PairAbi, functionName: 'getReserves',
              args: [], chainId: chain.id, poolPid: pid, dataType: 'lpReserves'
            });
          }
        }
      }
      
      setUserDataCalls(newUserCalls);
    }
    
    console.log("FarmTab: Updated derivedPools:", pools);
    return pools;
  }, [rawDistributionInfo, currentAddresses, userAddress, isConnected, chain, farmAddress]);

  // === Dynamic Contract Calls (User Data) ===
  const { data: userDataResults, isLoading: isLoadingUserData, error: userDataError, refetch: refetchUserData } = useReadContracts({
      contracts: userDataCalls,
      query: {
          enabled: isConnected && userDataCalls.length > 0 && derivedPools.length > 0,
      }
  });

  // Refetch static and user data when tab becomes active or user/chain changes
  useEffect(() => {
    if (isActive) {
      refetchStatic();
      if (userDataCalls.length > 0) {
          refetchUserData();
      }
    }
  }, [isActive, userAddress, chain?.id, refetchStatic, refetchUserData, userDataCalls.length]);

  // Handle successful TX: Refetch both static and user data
  const handleSuccess = () => {
    refetchStatic().then(() => {
        if (userDataCalls.length > 0) {
             refetchUserData().then(() => {
                console.log("FarmTab: Static & User data refetch completed after success.");
            });
        } else {
            console.log("FarmTab: Static data refetch completed after success (no user calls needed yet).");
        }
    });
  };

  // === Process User Data Results ===
  useEffect(() => {
      if (derivedPools.length === 0 || !userDataResults || userDataCalls.length === 0 || userDataResults.length !== userDataCalls.length) {
          if(derivedPools.length === 0 && !isLoadingStatic) {
            setProcessedFarmData([]);
          }
          return;
      }

      console.log("FarmTab: Processing userDataResults...", userDataResults);

      setDataMap(prevMap => {
          const currentMap = new Map(prevMap);

          userDataResults.forEach((result, index) => {
              const contractCall = userDataCalls[index];
              if (!contractCall) {
                console.error(`No contract call found at index ${index}`);
                return;
              }
              
              if (result.status !== 'success') {
                console.error(`Contract call failed at index ${index}:`, result.error || 'Unknown error');
                return;
              }

              const pid = contractCall.poolPid;
              const currentData = currentMap.get(pid);
              if (!currentData) {
                console.error(`No data found for PID ${pid} in dataMap`);
                return;
              }

              const value = result.result;
              console.log(`Processing result for PID ${pid}, dataType: ${contractCall.dataType}`, value);

              switch (contractCall.dataType) {
                  case 'walletBalance':
                      if (typeof value === 'bigint') currentData.walletBalance = value;
                      break;
                  case 'allowance':
                      if (typeof value === 'bigint') currentData.allowance = value;
                      break;
                  case 'pendingRewards':
                      if (typeof value === 'bigint') currentData.pendingRewards = value;
                      break;
                  case 'userInfoFetch':
                      // Handle different possible return formats to maximize compatibility
                      if (typeof value === 'object') {
                        // Object format (newer contracts, structured return)
                        if (value && 'amount' in value) {
                          currentData.stakedBalance = value.amount as bigint;
                          currentData.userInfo = {
                            rewardDebt: ('rewardDebt' in value) ? value.rewardDebt as bigint : 0n,
                            lastActionTimestamp: ('lastActionTimestamp' in value) ? value.lastActionTimestamp as bigint : 0n,
                            lastActionBlock: ('lastActionBlock' in value) ? value.lastActionBlock as bigint : 0n,
                            lastWithdrawTimestamp: ('lastWithdrawTimestamp' in value) ? value.lastWithdrawTimestamp as bigint : 0n, 
                            actionsInBlock: ('actionsInBlock' in value) ? value.actionsInBlock as bigint : 0n,
                            unlockTimestamp: ('unlockTimestamp' in value) ? value.unlockTimestamp as bigint : 0n,
                          };
                        } 
                        // Array format (older contracts)
                        else if (Array.isArray(value) && value.length >= 7 && typeof value[0] === 'bigint') {
                          currentData.stakedBalance = value[0];
                          currentData.userInfo = {
                              rewardDebt: value[1] as bigint,
                              lastActionTimestamp: value[2] as bigint,
                              lastActionBlock: value[3] as bigint,
                              lastWithdrawTimestamp: value[4] as bigint,
                              actionsInBlock: value[5] as bigint,
                              unlockTimestamp: value[6] as bigint,
                          };
                        } else {
                          console.warn(`FarmTab: Unexpected userInfo structure for PID ${pid}`, value);
                          // Still assign an empty object in case of unexpected format
                          currentData.stakedBalance = 0n;
                          currentData.userInfo = {
                              rewardDebt: 0n,
                              lastActionTimestamp: 0n,
                              lastActionBlock: 0n,
                              lastWithdrawTimestamp: 0n,
                              actionsInBlock: 0n,
                              unlockTimestamp: 0n,
                          };
                        }
                      } else {
                          console.warn(`FarmTab: Invalid userInfo format for PID ${pid}`, value);
                          currentData.stakedBalance = 0n;
                          currentData.userInfo = {
                              rewardDebt: 0n,
                              lastActionTimestamp: 0n,
                              lastActionBlock: 0n,
                              lastWithdrawTimestamp: 0n,
                              actionsInBlock: 0n,
                              unlockTimestamp: 0n,
                          };
                      }
                      break;
                  case 'lockInfoFetch':
                      // Process getUserStakeInfo response which returns:
                      // chosenBonusMultiplier, userUnlockTimestamp, secondsRemaining, poolOptions
                      if (Array.isArray(value) && value.length >= 3) {
                          // Parse the data returned from getUserStakeInfo
                          const chosenBonusMultiplier = typeof value[0] === 'bigint' ? value[0] : 10000n;
                          const userUnlockTimestamp = typeof value[1] === 'bigint' ? value[1] : 0n;
                          const secondsRemaining = typeof value[2] === 'bigint' ? value[2] : 0n;

                          currentData.lockInfo = {
                              lockDuration: secondsRemaining, // Use seconds remaining as lockDuration
                              bonusMultiplier: chosenBonusMultiplier,
                              userUnlockTimestamp: userUnlockTimestamp,
                              secondsRemaining: secondsRemaining,
                          };

                          // Process cooldown information using user info data
                          if (currentData.userInfo) {
                              const now = BigInt(Math.floor(Date.now() / 1000));
                              const lastAction = currentData.userInfo.lastActionTimestamp;
                              const lastWithdraw = currentData.userInfo.lastWithdrawTimestamp;
                              
                              // Standard cooldown periods - take these from the contract constants
                              const stakeCooldown = 3600n; // 1 hour (COOLDOWN constant in contract)
                              const withdrawCooldown = 1800n; // 30 minutes (WITHDRAW_COOLDOWN constant in contract)
                              
                              currentData.cooldownInfo = {
                                  lastActionTimestamp: lastAction,
                                  lastWithdrawTimestamp: lastWithdraw,
                                  cooldownEnds: lastAction + stakeCooldown,
                                  withdrawCooldownEnds: lastWithdraw + withdrawCooldown,
                                  isCooldownActive: now < lastAction + stakeCooldown,
                                  isWithdrawCooldownActive: now < lastWithdraw + withdrawCooldown
                              };
                          }
                      } else {
                          console.warn(`FarmTab: Invalid getUserStakeInfo format for PID ${pid}`, value);
                          // Set default values
                          currentData.lockInfo = {
                              lockDuration: 0n,
                              bonusMultiplier: 10000n, // 1.0x multiplier (no bonus)
                              userUnlockTimestamp: 0n,
                              secondsRemaining: 0n,
                          };
                      }
                      break;
                  case 'lpTotalSupply':
                      if (typeof value === 'bigint') currentData.lpTotalSupply = value;
                      break;
                  case 'lpReserves':
                      if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'bigint' && typeof value[1] === 'bigint') {
                          currentData.lpReserves = {
                              reserve0: value[0],
                              reserve1: value[1],
                          };
                      }
                      break;
              }
              currentMap.set(pid, currentData);
          });

          const finalData: FarmPoolCardData[] = derivedPools
              .map(pool => currentMap.get(pool.pid) as FarmPoolCardData | undefined)
              .filter((data): data is FarmPoolCardData => !!data && !!data.poolInfo);

          console.log("FarmTab: Final Processed Data for UI:", finalData);

          setProcessedFarmData(finalData);

          return currentMap;
      });

  }, [userDataResults, userDataCalls, derivedPools, isLoadingStatic]);

  // === Combine Loading States & Errors ===
  const isLoading = isLoadingStatic || (userDataCalls.length > 0 && isLoadingUserData);
  const combinedError = staticError || (userDataCalls.length > 0 ? userDataError : null);

  // === UI ===
  return (
    <VStack align="stretch" spacing={6}>
      <Box>
        <Heading size="md" mb={2}>Farm Pools</Heading>
        <Text mb={4} color="gray.500">Stake your LP tokens or SPARX to earn SPARX rewards.</Text>
      </Box>

      {!isConnected ? (
        <Center p={10}>
          <VStack spacing={4}>
            <Text fontSize="lg">Connect your wallet to view farm pools</Text>
            <ConnectButton />
          </VStack>
        </Center>
      ) : farmAddress === zeroAddress ? (
         <Center p={10}>
            <Alert status="warning" borderRadius="md">
                <AlertIcon />
                <AlertTitle>Farm contract not deployed or configured for this network.</AlertTitle>
            </Alert>
         </Center>
      ) : isLoading && derivedPools.length === 0 ? (
        <Center p={10}>
          <Spinner size="xl" />
        </Center>
      ) : combinedError ? (
          <Alert status="error" borderRadius="md">
            <AlertIcon />
            <AlertTitle>Error fetching farm data: {combinedError instanceof Error ? (combinedError as any).shortMessage || combinedError.message : combinedError.message}</AlertTitle>
          </Alert>
      ) : !isLoading && derivedPools.length === 0 ? (
         <Center p={10}>
            <Text fontSize="lg">No farm pools found for this network.</Text>
        </Center>
      ) : (
        <>
          <SimpleGrid columns={{ base: 1, lg: derivedPools.length > 1 ? 2 : 1 }} spacing={4}>
            {processedFarmData.map((data) => (
              <FarmPoolCard
                key={data.poolInfo.pid}
                data={data}
                farmAddress={farmAddress}
                farmAbi={farmAbiTyped}
                onSuccessfulTx={handleSuccess}
                totalAllocPoint={rawDistributionInfo?.allocPoints.reduce((sum: bigint, val: bigint) => sum + val, 0n) ?? 0n}
                currentRate={farmStats?.currentRate ?? 0n}
                distributionShare={data.distributionShare}
              />
            ))}
          </SimpleGrid>
          
          {/* Farm Information Card */}
          <Card bg="#1a202c" borderColor="gray.700" variant="outline" mt={6} overflow="hidden">
            <CardBody p={6}>
              <VStack spacing={6} align="center">
                {/* Farmer Fox Mascot */}
                <Box mb={2}>
                  <Image 
                    src="/sparx-farm.png" 
                    alt="Sparx Farmer" 
                    width="200px"
                    height="200px"
                    objectFit="contain"
                  />
                </Box>
                
                {/* Information Sections - Side by Side */}
                <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={{ base: 6, md: 10 }} w="full" maxW="900px">
                  {/* LP Rewards Section */}
                  <Box>
                    <Flex align="center" mb={4}>
                      <Icon as={InfoIcon} color="#FF6937" boxSize={5} mr={2} />
                      <Heading size="md" color="#FF6937">LP Farming Rewards</Heading>
                    </Flex>
                    
                    <Text fontSize="sm" color="gray.200" mb={4} pl={1}>
                      Providing liquidity and staking LP tokens offers multiple benefits:
                    </Text>
                    
                    <List spacing={3} pl={1}>
                      <ListItem color="gray.200" fontSize="sm" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>Earn trading fees from the liquidity pool</Text>
                      </ListItem>
                      <ListItem color="gray.200" fontSize="sm" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>Earn SPARX rewards from the farm</Text>
                      </ListItem>
                      <ListItem color="gray.200" fontSize="sm" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>Higher APR than single-sided staking</Text>
                      </ListItem>
                    </List>
                  </Box>
                  
                  {/* Farm Mechanics Section */}
                  <Box>
                    <Flex align="center" mb={4}>
                      <Icon as={LockIcon} color="#38bdf8" boxSize={5} mr={2} />
                      <Heading size="md" color="#38bdf8">Farm Mechanics</Heading>
                    </Flex>
                    
                    <Text fontSize="sm" color="gray.200" mb={4} pl={1}>
                      Farm pools follow these mechanics:
                    </Text>
                    
                    <List spacing={3} pl={1}>
                      <ListItem color="gray.200" fontSize="sm" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>Same cooldown periods as staking: 1hr stake, 30min withdraw</Text>
                      </ListItem>
                      <ListItem color="gray.200" fontSize="sm" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>Optional locking for 7-30 days for 50-200% APR boost</Text>
                      </ListItem>
                      <ListItem color="gray.200" fontSize="sm" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>Rewards auto-compound for higher yields</Text>
                      </ListItem>
                    </List>
                  </Box>
                </Grid>
              </VStack>
            </CardBody>
          </Card>
        </>
      )}
    </VStack>
  )
}

export default FarmTab 