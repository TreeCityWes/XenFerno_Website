import { Box, VStack, Heading, Text, SimpleGrid, Alert, AlertIcon, AlertTitle, Center, Spinner, Flex, Card, CardBody, Icon, Divider, HStack, Badge, Image, Grid, List, ListItem } from '@chakra-ui/react'
import { useMemo, useEffect, useState } from 'react'
// Use StakingPoolCard instead of FarmPoolCard
import { StakingPoolCard } from './StakingPoolCard'
import { useAccount, useReadContracts } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { getAddressesForChain, Addresses, isContractDeployed } from '../../config/contracts'
// import { getStakingPools, PoolInfo } from '../../config/pools' // Remove static pool config import
import { type Abi, zeroAddress } from 'viem'
import farmAbi from '../../abis/SparxFarm.json' with { type: 'json' }
import erc20Abi from '../../abis/ERC20.json' with { type: 'json' }
// Reuse definitions from FarmTab
import { PoolInfoInternal, PoolInfoContract } from '../Farm/FarmTab' // Import types
import { mapLpAddressToInfo } from '../../utils/poolUtils'; // Import helper from new location
import { InfoIcon, LockIcon, TimeIcon, UnlockIcon } from '@chakra-ui/icons'

// Define theme colors used in this tab (match StakingPoolCard for consistency)
const darkCardBg = '#252f3f';           // Card background from screenshot
const darkInputBg = '#1e293b';          // Input/Tab background from screenshot
const borderColor = '#374151';          // Border color from screenshot
const lightTextColor = '#e5e7eb';       // Lighter text color for main values
const subtleTextColor = '#9ca3af';      // Dimmer text color for labels/helpers
const infoIconColor = '#eab308';        // Gold for Info icon
const cooldownIconColor = '#38bdf8';     // Light blue for Cooldown icon
const lockIconColor = '#FF6937';        // Orange for Lock icon
const lockedBadgeBg = '#b91c1c';        // Red background for LOCKED badge

// Define types for lock options from contract
interface LockOption {
  duration: bigint;
  bonusMultiplier: bigint;
}

interface UserLockInfo {
  chosenBonusMultiplier: bigint;
  unlockTimestamp: bigint;
  secondsRemaining: bigint;
}

// Define type for the farm pool card data with optional lock options
interface FarmPoolCardData {
  poolInfo: PoolInfoInternal;
  walletBalance: bigint | null;
  allowance: bigint | null;
  pendingRewards: bigint | null;
  stakedBalance: bigint | null;
  cooldownInfo: any | null;
  lockInfo: UserLockInfo | null;
  lockOptions: LockOption[];
  distributionShare?: bigint | null;
}

// Type ABIs
const farmAbiTyped = farmAbi as Abi;
const erc20AbiTyped = erc20Abi as Abi;

// Define props for the tab component
interface TabProps {
  isActive: boolean;
}

function StakingTab({ isActive }: TabProps) {
  const { address: userAddress, isConnected, chain } = useAccount();
  const [poolCount, setPoolCount] = useState<number>(0);
  // State to hold the identified staking pools (SPARX and potentially XBURN)
  const [stakingPools, setStakingPools] = useState<PoolInfoInternal[]>([]); 
  // State to hold the processed data for rendering the cards
  const [processedStakingData, setProcessedStakingData] = useState<FarmPoolCardData[]>([]); 
  const [userDataCalls, setUserDataCalls] = useState<any[]>([]);
  const [dataMap, setDataMap] = useState<Map<number, Partial<FarmPoolCardData>>>(new Map());
  const [poolDistributionShares, setPoolDistributionShares] = useState<bigint[]>([]); 

  // Get dynamic addresses based on chain
  const currentAddresses = useMemo(() => getAddressesForChain(chain?.id), [chain?.id]);
  const farmAddress = useMemo(() => currentAddresses.farm as `0x${string}`, [currentAddresses]);
  const sparxAddress = useMemo(() => currentAddresses.sparx as `0x${string}` | undefined, [currentAddresses]); // Allow undefined
  const xburnAddress = useMemo(() => currentAddresses.xburn as `0x${string}` | undefined, [currentAddresses]); // Allow undefined

  // === Static Contract Calls (Pool Count, Alloc Point, Rate, Distribution) ===
  const staticContracts = useMemo(() => {
    if (!isConnected || !chain || !isContractDeployed(farmAddress)) return [];
    return [
      { address: farmAddress, abi: farmAbiTyped, functionName: 'poolLength', chainId: chain.id },
      { address: farmAddress, abi: farmAbiTyped, functionName: 'totalAllocPoint', chainId: chain.id },
      { address: farmAddress, abi: farmAbiTyped, functionName: 'currentRate', chainId: chain.id },
      { address: farmAddress, abi: farmAbiTyped, functionName: 'getPoolDistributionInfo', chainId: chain.id },
    ];
  }, [isConnected, chain?.id, farmAddress]);

  const { data: staticResults, isLoading: isLoadingStatic, error: staticError } = useReadContracts({
    contracts: staticContracts,
    query: { enabled: isConnected && staticContracts.length > 0 },
  });

  // Update poolCount and shares when static data is available
  useEffect(() => {
    if (staticResults && staticResults[0]?.status === 'success') {
      const count = Number(staticResults[0].result);
      if (!isNaN(count)) setPoolCount(count);
    }
    if (staticResults && staticResults[3]?.status === 'success') {
        const distributionData = staticResults[3].result as any[];
        if (distributionData && distributionData.length === 5 && Array.isArray(distributionData[4])) {
            setPoolDistributionShares(distributionData[4] as bigint[]);
        }
    }
  }, [staticResults]);

  // === Dynamic Contract Calls (Pool Info for ALL pools initially) ===
  const poolInfoContracts = useMemo(() => {
    const calls: any[] = [];
    if (!isConnected || !chain || poolCount === 0 || !isContractDeployed(farmAddress)) return [];
    for (let pid = 0; pid < poolCount; pid++) {
      calls.push({
        address: farmAddress, abi: farmAbiTyped, functionName: 'poolInfo', 
        args: [BigInt(pid)], chainId: chain.id, poolPid: pid, dataType: 'poolInfo'
      });
    }
    return calls;
  }, [isConnected, chain?.id, poolCount, farmAddress]);

  const { data: poolInfoResults, isLoading: isLoadingPoolInfo, error: poolInfoError, refetch: refetchPoolInfo } = useReadContracts({
    contracts: poolInfoContracts,
    query: { enabled: isConnected && poolInfoContracts.length > 0 && poolCount > 0 }
  });

  // === Dynamic Contract Calls (User Data for identified staking pools) ===
  const { data: userDataResults, isLoading: isLoadingUserData, error: userDataError, refetch: refetchUserData } = useReadContracts({
      contracts: userDataCalls, // Use state for calls
      // Enable when calls are ready and *at least one* staking pool is found
      query: { enabled: isConnected && userDataCalls.length > 0 && stakingPools.length > 0 } 
  });

  // Refetch data
  useEffect(() => {
    if (isActive) {
      refetchPoolInfo();
      if (userDataCalls.length > 0) refetchUserData();
    }
  }, [isActive, userAddress, refetchPoolInfo, refetchUserData, userDataCalls.length]);

  const handleSuccess = () => {
    refetchPoolInfo().then(() => {
        if (userDataCalls.length > 0) {
             refetchUserData().then(() => console.log("StakingTab: User data refetch completed after success."));
        }
    });
  };

  // === Process Pool Info Results to find SPARX and XBURN pools and setup user calls ===
  useEffect(() => {
    // Ensure addresses are valid before proceeding
    if (!poolInfoResults || poolCount === 0 || !farmAddress || (!sparxAddress && !xburnAddress)) {
        setStakingPools([]);
        setUserDataCalls([]);
        return;
    }
    
    const foundPools: PoolInfoInternal[] = [];
    const newUserCalls: any[] = [];
    const newDataMap = new Map<number, Partial<FarmPoolCardData>>();

    poolInfoResults.forEach((result, index) => {
        const contractCall = poolInfoContracts[index];
        if (!contractCall || result.status !== 'success' || contractCall.dataType !== 'poolInfo') return;
        
        const poolResultArray = result.result as any[];
        if (!poolResultArray || poolResultArray.length < 5 || typeof poolResultArray[0] !== 'string' || typeof poolResultArray[1] !== 'bigint') return;

        const lpAddress = poolResultArray[0] as `0x${string}`;
        const lpAddressLower = lpAddress.toLowerCase();
        const allocPoint = poolResultArray[1] as bigint;
        const pid = contractCall.poolPid;

        // --- Filtering Logic: Check for SPARX or XBURN address match ---
        const isSparxPool = sparxAddress && lpAddressLower === sparxAddress.toLowerCase();
        const isXburnPool = xburnAddress && lpAddressLower === xburnAddress.toLowerCase();

        if (isSparxPool || isXburnPool) {
            const basicInfo = mapLpAddressToInfo(lpAddress, currentAddresses);
            const poolToAdd: PoolInfoInternal = {
                ...basicInfo,
                pid: pid,
                lpAddress: lpAddress,
                allocPoint: allocPoint,
            };
            foundPools.push(poolToAdd);

            // Initialize map entry
            newDataMap.set(pid, { poolInfo: poolToAdd });

            // Setup user data calls for this found pool
            if (userAddress && isConnected && chain && isContractDeployed(lpAddress) && isContractDeployed(farmAddress)) {
                const callsToAdd = [
                    { address: lpAddress, abi: erc20AbiTyped, functionName: 'balanceOf', args: [userAddress], chainId: chain.id, poolPid: pid, dataType: 'walletBalance' },
                    { address: lpAddress, abi: erc20AbiTyped, functionName: 'allowance', args: [userAddress, farmAddress], chainId: chain.id, poolPid: pid, dataType: 'allowance' },
                    { address: farmAddress, abi: farmAbiTyped, functionName: 'pendingRewards', args: [BigInt(pid), userAddress], chainId: chain.id, poolPid: pid, dataType: 'pendingRewards' },
                    { address: farmAddress, abi: farmAbiTyped, functionName: 'userInfo', args: [BigInt(pid), userAddress], chainId: chain.id, poolPid: pid, dataType: 'userInfo' },
                    { address: farmAddress, abi: farmAbiTyped, functionName: 'userCooldownInfo', args: [BigInt(pid), userAddress], chainId: chain.id, poolPid: pid, dataType: 'cooldownInfo' },
                    { address: farmAddress, abi: farmAbiTyped, functionName: 'getUserStakeInfo', args: [BigInt(pid), userAddress], chainId: chain.id, poolPid: pid, dataType: 'lockInfo' },
                ];
                newUserCalls.push(...callsToAdd);
            }
        }
    });

    // Update state with all found pools and their user calls
    setStakingPools(foundPools);
    setUserDataCalls(newUserCalls);
    setDataMap(newDataMap);

  }, [poolInfoResults, poolInfoContracts, poolCount, userAddress, isConnected, chain, farmAddress, sparxAddress, xburnAddress, currentAddresses]);

  // === Process User Data Results ===
  useEffect(() => {
      // Check if stakingPools is populated and user data is loaded
      if (stakingPools.length === 0 || !userDataResults || userDataCalls.length === 0 || userDataResults.length !== userDataCalls.length) {
         if (stakingPools.length === 0 && !isLoadingPoolInfo && !isLoadingStatic) {
            setProcessedStakingData([]); // Set to empty array if no pools found
         }
         return; 
      }

      setDataMap(prevMap => {
          const currentMap = new Map(prevMap); // Clone previous map

          // Process results for all pools
          userDataResults.forEach((result, index) => {
              const contractCall = userDataCalls[index];
              if (!contractCall || result.status !== 'success') return;
              
              const pid = contractCall.poolPid;
              const currentData = currentMap.get(pid);
              if (!currentData) return; // Skip if pool wasn't found initially

              const value = result.result;
              switch (contractCall.dataType) {
                   case 'walletBalance': if (typeof value === 'bigint') currentData.walletBalance = value; break;
                   case 'allowance': if (typeof value === 'bigint') currentData.allowance = value; break;
                   case 'pendingRewards': if (typeof value === 'bigint') currentData.pendingRewards = value; break;
                   case 'userInfo': 
                        if (Array.isArray(value) && value.length >= 6 && typeof value[0] === 'bigint') currentData.stakedBalance = value[0];
                        else console.warn(`StakingTab: Unexpected userInfo structure for PID ${pid}`, value);
                        break;
                   case 'cooldownInfo':
                       if (Array.isArray(value) && value.length >= 7 && typeof value[1] === 'bigint') {
                           currentData.cooldownInfo = {
                               lastActionTimestamp: value[1], lastWithdrawTimestamp: value[2],
                               cooldownEnds: value[3], withdrawCooldownEnds: value[4],
                               isCooldownActive: value[5] as boolean, isWithdrawCooldownActive: value[6] as boolean,
                           };
                       } else {
                          console.warn(`StakingTab: Unexpected userCooldownInfo structure for PID ${pid}`, value);
                          currentData.cooldownInfo = null;
                       }
                       break;
                   case 'lockInfo':
                       if (Array.isArray(value) && value.length >= 4) {
                           // First three items are user's stake info
                           currentData.lockInfo = {
                               chosenBonusMultiplier: value[0] as bigint,
                               unlockTimestamp: value[1] as bigint,
                               secondsRemaining: value[2] as bigint
                           };
                           
                           // Fourth item is array of lock options
                           if (Array.isArray(value[3])) {
                               currentData.lockOptions = value[3].map((option: any) => ({
                                   duration: option.duration as bigint,
                                   bonusMultiplier: option.bonusMultiplier as bigint
                               }));
                               console.log(`StakingTab: Found ${currentData.lockOptions.length} lock options for PID ${pid}`, currentData.lockOptions);
                           }
                       } else {
                           console.warn(`StakingTab: Unexpected getUserStakeInfo structure for PID ${pid}`, value);
                           currentData.lockInfo = null;
                           currentData.lockOptions = [];
                       }
                       break;
              }
              // Update map entry
              currentMap.set(pid, currentData);
          });

          // Convert the final map back to the processedStakingData array
          // Ensure order matches stakingPools or filter based on map keys
          const finalData: FarmPoolCardData[] = stakingPools
              .map(pool => currentMap.get(pool.pid))
              .filter((data): data is Partial<FarmPoolCardData> => !!data) // Filter out undefined entries
              .map(partialData => partialData as FarmPoolCardData); // Cast to full type (assuming poolInfo is present)
          
          // Add distribution shares
          finalData.forEach(data => {
              if (data.poolInfo && data.poolInfo.pid < poolDistributionShares.length) {
                  (data as any).distributionShare = poolDistributionShares[data.poolInfo.pid];
              } else {
                  (data as any).distributionShare = null;
              }
          });
          
          setProcessedStakingData(finalData); // Update the final display data array

          return currentMap; // Return the updated map state
      });

  }, [userDataResults, userDataCalls, stakingPools, poolDistributionShares, isLoadingPoolInfo, isLoadingStatic]); // Add loading dependencies

  // === Combine Loading States & Errors ===
  const isLoading = isLoadingStatic || isLoadingPoolInfo || (userDataCalls.length > 0 && isLoadingUserData);
  const combinedError = staticError || poolInfoError || userDataError;

  // === UI ===
  return (
    <VStack align="stretch" spacing={6}>
      <Box>
        <Heading size="md" mb={2}>Staking Pools</Heading>
        <Text mb={4} color="gray.500">Stake your SPARX tokens to earn SPARX rewards.</Text>
      </Box>
      
      {!isConnected ? (
        <Center p={10}>
          <VStack spacing={4}>
            <Text fontSize="lg">Connect your wallet to view staking pools</Text>
            <ConnectButton />
          </VStack>
        </Center>
      ) : isLoading && processedStakingData.length === 0 ? (
        <Center p={10}>
          <Spinner size="xl" />
        </Center>
      ) : combinedError ? (
        <Alert status="error" borderRadius="md">
          <AlertIcon />
          <AlertTitle>Error fetching staking data: {combinedError.message}</AlertTitle>
        </Alert>
      ) : processedStakingData.length > 0 ? (
        <>
          <SimpleGrid columns={{ base: 1, md: processedStakingData.length > 1 ? 2 : 1 }} spacing={4}>
            {processedStakingData.map(poolData => (
              <StakingPoolCard 
                key={poolData.poolInfo.pid}
                data={poolData}
                farmAddress={farmAddress}
                farmAbi={farmAbiTyped}
                onSuccessfulTx={handleSuccess}
                totalAllocPoint={staticResults?.[1]?.status === 'success' ? staticResults[1].result as bigint : BigInt(0)}
                currentRate={staticResults?.[2]?.status === 'success' ? staticResults[2].result as bigint : BigInt(0)}
                distributionShare={poolData.distributionShare ?? null}
              />
            ))}
          </SimpleGrid>
          
          {/* Staking Information Card - Now below the pool cards */}
          <Card bg="#1a202c" borderColor="gray.700" variant="outline" mt={6} overflow="hidden">
            <CardBody p={6}>
              <VStack spacing={6} align="center">
                {/* Rocket Fox Mascot */}
                <Box mb={2}>
                  <Image 
                    src="/sparx-rocket.png" 
                    alt="Sparx Rocket" 
                    width="200px"
                    height="200px"
                    objectFit="contain"
                  />
                </Box>
                
                {/* Information Sections - Side by Side */}
                <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={{ base: 6, md: 10 }} w="full" maxW="900px">
                  {/* Lock Period Section FIRST */}
                  <Box>
                    <Flex align="center" mb={4}>
                      <Icon as={LockIcon} color="#FF6937" boxSize={5} mr={2} />
                      <Heading size="md" color="#FF6937">Lock Periods</Heading>
                    </Flex>
                    
                    <Text fontSize="md" color="gray.200" mb={4} pl={1}>
                      Locking your stake increases your rewards. Longer lock periods offer better bonuses:
                    </Text>
                    
                    <List spacing={3} pl={1}>
                      <ListItem color="gray.200" fontSize="md" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>7 days: +50% reward boost</Text>
                      </ListItem>
                      <ListItem color="gray.200" fontSize="md" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>14 days: +100% reward boost</Text>
                      </ListItem>
                      <ListItem color="gray.200" fontSize="md" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>30 days: +200% reward boost</Text>
                      </ListItem>
                    </List>
                  </Box>
                  
                  {/* Cooldown Section SECOND */}
                  <Box>
                    <Flex align="center" mb={4}>
                      <Icon as={TimeIcon} color="#38bdf8" boxSize={5} mr={2} />
                      <Heading size="md" color="#38bdf8">Cooldown Periods</Heading>
                    </Flex>
                    
                    <Text fontSize="md" color="gray.200" mb={4} pl={1}>
                      After each action, a cooldown period applies:
                    </Text>
                    
                    <List spacing={3} pl={1}>
                      <ListItem color="gray.200" fontSize="md" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>Stake/Harvest: 1 hour cooldown</Text>
                      </ListItem>
                      <ListItem color="gray.200" fontSize="md" display="flex">
                        <Text as="span" mr={2}>•</Text>
                        <Text>Withdraw: 30 minute cooldown</Text>
                      </ListItem>
                    </List>
                    
                    <Text fontSize="md" color="gray.200" mt={4} pl={1}>
                      Cooldowns prevent flash loan attacks and maintain reward stability.
                    </Text>
                  </Box>
                </Grid>
              </VStack>
            </CardBody>
          </Card>
        </>
      ) : (
        <Center p={10}>
          <Text fontSize="lg">No SPARX or XBURN staking pool found for this network.</Text>
        </Center>
      )}
    </VStack>
  )
}

export default StakingTab 