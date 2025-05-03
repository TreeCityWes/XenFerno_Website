import { Box, VStack, Heading, Text, Button, useToast, Spinner, Center, SimpleGrid, Flex, Skeleton, Alert, AlertIcon, AlertTitle, HStack, Divider, Icon, Image, Grid, Card, CardBody, List, ListItem } from '@chakra-ui/react';
import { useState, useEffect, useMemo } from 'react';
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { getAddressesForChain, isContractDeployed } from '../../config/contracts';
import burnerAbiJson from '../../abis/SparxBurner.json' with { type: 'json' };
import erc20Abi from '../../abis/ERC20.json' with { type: 'json' };
import { type Abi, formatUnits, parseUnits, BaseError, zeroAddress, Address } from 'viem';
import { FaFire, FaArrowRight, FaExchangeAlt } from 'react-icons/fa';
import { keyframes } from '@emotion/react';
import { useColorMode } from '@chakra-ui/react';

// Type ABIs
const burnerAbiTyped = burnerAbiJson as Abi;
const erc20AbiDirect = erc20Abi as Abi; 

// --- DeFi Theme Colors (Match StakingPoolCard colors) ---
const primaryColor = '#FF6937';          // Accent orange for icons and highlights
const sparxColor = '#FF9500';            // Orange for SPARX token
const xburnColor = '#FACC15';            // Yellow for XBURN token
const darkCardBg = '#252f3f';            // Card background
const darkInputBg = '#1e293b';           // Input/Tab area background
const borderColor = '#374151';           // Borders
const buttonBrown = '#92400e';           // Brown for Harvest/Stake/Approve buttons
const buttonBrownHover = '#b45309';      // Hover for brown buttons
const lightTextColor = '#F7FAFC';        // Main text color (balances, etc.)
const subtleTextColor = '#9ca3af';       // Dimmer text color (labels)
const warningColor = '#FACC15';          // Warning text
const errorColor = '#DC2626';            // Red for errors

// Add keyframes for fire animation
const flicker = keyframes`
  0% { transform: scale(0.95); opacity: 0.8; }
  25% { transform: scale(1.05); opacity: 1; }
  50% { transform: scale(0.97); opacity: 0.9; }
  75% { transform: scale(1.03); opacity: 0.95; }
  100% { transform: scale(0.98); opacity: 0.85; }
`;

interface TabProps {
  isActive: boolean;
}

// Format numbers with commas and proper decimals
const formatBigIntDisplay = (value: bigint | null | undefined, decimals = 18, displayDecimals = 4) => {
    if (value === null || typeof value === 'undefined') return '0.0000';
    
    // Format with units
    const formatted = formatUnits(value, decimals);
    
    // Handle display of large numbers with commas
    const [integerPart, fractionalPart = ''] = formatted.split('.');
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    
    return `${formattedInteger}.${fractionalPart.slice(0, displayDecimals).padEnd(displayDecimals, '0')}`;
};

// FireIcon component
const FireIcon = ({ size = "24px", color = primaryColor }) => (
  <Icon as={FaFire} w={size} h={size} color={color} />
);

// Helper component for key-value display (from StakingPoolCard)
interface DataRowProps {
  label: string;
  children: React.ReactNode;
  isLoading?: boolean;
  labelColor?: string;
  valueColor?: string;
  labelSize?: string;
  valueSize?: string;
  valueWeight?: string;
}

const DataRow = ({ label, children, isLoading = false, labelColor = subtleTextColor, valueColor = lightTextColor, labelSize = "sm", valueSize = "md", valueWeight = "medium" }: DataRowProps) => (
  <Flex justify="space-between" align="center" w="full">
    <Text fontSize={labelSize} color={labelColor}>{label}</Text>
    <Skeleton isLoaded={!isLoading}>
      <Text fontSize={valueSize} fontWeight={valueWeight} color={valueColor} textAlign="right">{children}</Text>
    </Skeleton>
  </Flex>
);

function BurnerTab({ isActive }: TabProps) {
  const { address: userAddress, isConnected, chain } = useAccount();
  const toast = useToast();
  const { colorMode } = useColorMode();
  const [availableToBurn, setAvailableToBurn] = useState<bigint | null>(null);
  const [minimumIgniteAmount, setMinimumIgniteAmount] = useState<bigint | null>(null);
  const [xburnOutputEstimate, setXburnOutputEstimate] = useState<bigint | null>(null);
  const [swapPath, setSwapPath] = useState<Address[] | null>(null);

  // --- Dynamic Addresses ---
  const currentAddresses = useMemo(() => getAddressesForChain(chain?.id), [chain?.id]);
  const burnerAddress = useMemo(() => {
    const addr = currentAddresses.burner;
    return addr && isContractDeployed(addr) ? addr as Address : zeroAddress;
  }, [currentAddresses]);
  const sparxAddress = useMemo(() => {
    const addr = currentAddresses.sparx;
    return addr && isContractDeployed(addr) ? addr as Address : zeroAddress;
  }, [currentAddresses]);
  const xburnAddress = useMemo(() => {
    const addr = currentAddresses.xburn;
    return addr && isContractDeployed(addr) ? addr as Address : zeroAddress;
  }, [currentAddresses]);

  // --- Contract Read Setup ---
  const contractsToRead = useMemo(() => {
    const calls: any[] = [];
    const currentChainId = chain?.id;
    if (!isConnected || !currentChainId || burnerAddress === zeroAddress) return [];

    // 1. SPARX available to burn in the contract
    if (sparxAddress !== zeroAddress) {
        calls.push({
            address: sparxAddress, // SPARX contract
            abi: erc20AbiDirect,
            functionName: 'balanceOf',
            args: [burnerAddress], // Balance *of* the burner address
            chainId: currentChainId,
            dataType: 'sparxAvailableToBurn'
        });
    }
    
    // 2. Minimum Ignite Amount
    calls.push({
        address: burnerAddress,
        abi: burnerAbiTyped,
        functionName: 'minimumIgniteAmount',
        args: [],
        chainId: currentChainId,
        dataType: 'minimumIgniteAmount'
    });

    // 3. Get swap path
    calls.push({
        address: burnerAddress,
        abi: burnerAbiTyped,
        functionName: 'getSwapPath',
        args: [],
        chainId: currentChainId,
        dataType: 'swapPath'
    });

    return calls;
  }, [isConnected, chain?.id, burnerAddress, sparxAddress]);

  // Add XBURN estimate call separately
  const xburnEstimateCall = useMemo(() => {
    const currentChainId = chain?.id;
    // Only create the call if we have an available amount to burn
    if (!isConnected || !currentChainId || burnerAddress === zeroAddress || !availableToBurn || availableToBurn <= 0n) {
      return null;
    }

    return {
      address: burnerAddress,
      abi: burnerAbiTyped,
      functionName: 'estimateXBurnOut',
      args: [availableToBurn],
      chainId: currentChainId
    };
  }, [isConnected, chain?.id, burnerAddress, availableToBurn]);

  // Read main contract data
  const { data: readResults, isLoading: isReadLoading, error: readError, refetch: refetchReads } = useReadContracts({
      contracts: contractsToRead,
      query: {
          enabled: isActive && isConnected && contractsToRead.length > 0,
      }
  });

  // Read XBURN estimate separately
  const { data: xburnEstimateResult, refetch: refetchEstimate } = useReadContracts({
    contracts: xburnEstimateCall ? [xburnEstimateCall] : [],
    query: {
      enabled: isActive && isConnected && xburnEstimateCall !== null,
    }
  });

  // Process Read Results
  useEffect(() => {
    if (!readResults) return;

    let sparxAmount: bigint | null = null;
    let minAmount: bigint | null = null;
    let pathAddresses: Address[] | null = null;

    readResults.forEach((result, index) => {
      if (result.status !== 'success') return;

      const contractCall = contractsToRead[index];
      if (!contractCall) return;

      switch (contractCall.dataType) {
        case 'sparxAvailableToBurn':
          sparxAmount = result.result as bigint;
          // Remove mock test amount
          setAvailableToBurn(sparxAmount);
          break;
        case 'minimumIgniteAmount':
          minAmount = result.result as bigint;
          setMinimumIgniteAmount(minAmount);
          break;
        case 'swapPath':
          pathAddresses = result.result as Address[];
          setSwapPath(pathAddresses);
          break;
      }
    });

    // Trigger XBURN estimate refetch when SPARX amount changes
    if (sparxAmount && sparxAmount > 0n) {
      refetchEstimate();
    }
  }, [readResults, contractsToRead, refetchEstimate]);

  // Process XBURN estimate
  useEffect(() => {
    if (!xburnEstimateResult || !xburnEstimateResult[0] || xburnEstimateResult[0].status !== 'success') {
      // Don't use mock values, just set to null or 0n if no real estimate
      setXburnOutputEstimate(0n);
      return;
    }
    
    setXburnOutputEstimate(xburnEstimateResult[0].result as bigint);
  }, [xburnEstimateResult, availableToBurn]);

  // Derived state: Check if minimum ignite amount is met
  const isMinimumMet = useMemo(() => {
    if (availableToBurn === null || minimumIgniteAmount === null) return false;
    return availableToBurn >= minimumIgniteAmount;
  }, [availableToBurn, minimumIgniteAmount]);

  // --- Contract Write Setup ---
  const { data: hash, error: writeError, isPending, writeContract } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, error: confirmationError } = useWaitForTransactionReceipt({ hash });
  const isTxLoading = isPending || isConfirming;

  // --- Event Handlers ---
  const handleIgnite = () => {
    if (!isMinimumMet) {
        toast({ title: "Minimum Not Met", description: `Cannot ignite: Need at least ${formatBigIntDisplay(minimumIgniteAmount, 18, 2)} SPARX.`, status: "error" });
        return;
    }
    if (!userAddress || burnerAddress === zeroAddress) {
        toast({ title: "Cannot Ignite", description: "User address or burner contract address is missing.", status: "error" });
        return;
    }

    // Default to 85% minimum output (15% slippage)
    const defaultMinAmountOutPercent = 85n;

    writeContract({
      address: burnerAddress,
      abi: burnerAbiTyped,
      functionName: 'ignite',
      args: [defaultMinAmountOutPercent],
    });
  };

  // --- Transaction Result Handling ---
  useEffect(() => {
    if (isConfirmed) {
      toast({ title: 'Ignition Successful!', status: 'success', duration: 5000 });
      refetchReads(); // Refetch balance
    }
    const txError = writeError || confirmationError;
    if (txError) {
      const message = txError instanceof BaseError ? txError.shortMessage : txError?.message || 'Unknown error';
      toast({ title: 'Transaction Failed', description: message, status: 'error', duration: 7000 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed, writeError, confirmationError]);

   // --- Initial Reads & Refetch on Activation ---
  useEffect(() => {
    if (isActive && isConnected) {
      refetchReads();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, isConnected]);

  // --- UI Rendering ---
  const isLoading = isReadLoading;

  if (!isConnected) {
    return (
      <Center p={10}>
        <VStack spacing={4}>
          <Text fontSize="lg" color={lightTextColor}>Connect your wallet to use the Sparx Burner</Text>
          <ConnectButton />
        </VStack>
      </Center>
    );
  }
  
  if (burnerAddress === zeroAddress || sparxAddress === zeroAddress) {
    return (
      <Center p={10}>
        <Alert status="warning" borderRadius="md">
          <AlertIcon />
          <AlertTitle>Required contracts (Burner or SPARX) not deployed or configured for this network.</AlertTitle>
        </Alert>
      </Center>
    );
  }

  // Exchange rate calculation
  const exchangeRate = xburnOutputEstimate && availableToBurn && availableToBurn > 0n ? 
    (Number(formatUnits(xburnOutputEstimate, 18)) / Number(formatUnits(availableToBurn, 18))).toFixed(4) : 
    '...';

  // Approximate USD value (just for display)
  const estimatedUsdValue = xburnOutputEstimate 
    ? `~$${(parseFloat(formatBigIntDisplay(xburnOutputEstimate)) * 0.015).toFixed(2)} USD` 
    : '';

  return (
    <Box p={4} borderRadius="lg">
      {/* Use the same VStack layout style as StakingTab */}
      <VStack align="stretch" spacing={6}>
        <Box>
          <Heading size="md" mb={2} color={lightTextColor}>Sparx Igniter</Heading>
          <Text mb={4} color={subtleTextColor}>Ignite the accumulated SPARX in the burner contract to Buy and Burn XBURN and SPARX tokens.</Text>
        </Box>

        {/* Error handling */}
        {readError && (
          <Alert status="error" borderRadius="md" bg="red.900" borderColor="red.700" mb={4}>
            <AlertIcon color="red.300"/>
            <AlertTitle color={lightTextColor}>Error fetching data: {readError instanceof BaseError ? readError.shortMessage : readError.message}</AlertTitle>
          </Alert>
        )}

        {/* Main Burner Card with StakingPoolCard styling */}
        <Box 
          borderWidth="1px" 
          borderRadius="lg" 
          overflow="hidden"
          p={5} 
          bg={darkCardBg} 
          borderColor={borderColor} 
          boxShadow="md"
          transition='all 0.2s ease-out'
          _hover={{ borderColor: primaryColor, boxShadow: 'lg' }}
          position="relative"
          display="flex"
          flexDirection="column"
          minHeight="300px"
        >
          <VStack align="stretch" spacing={4} flexGrow={1}>
            {/* Header */}
            <Flex justify="space-between" align="center">
              <HStack>
                <Box position="relative" animation={`${flicker} 3s infinite ease-in-out`}>
                  <FireIcon size="30px" color={primaryColor} />
                </Box>
                <Heading size="md" color={sparxColor}>Sparx Igniter</Heading>
              </HStack>
            </Flex>

            {/* Stats Section - Match StakingPoolCard Grid layout */}
            <Grid templateColumns="repeat(2, 1fr)" gap={6}>
              {/* Left column - SPARX Balance */}
              <Box>
                <Text fontSize="sm" color={subtleTextColor} mb={1}>SPARX Available to Ignite</Text>
                <Skeleton isLoaded={!isLoading}>
                  <HStack spacing={2} align="baseline">
                    <Text 
                      fontSize="xl" 
                      fontWeight="bold"
                      color={isMinimumMet ? sparxColor : errorColor}
                    >
                      {formatBigIntDisplay(availableToBurn, 18, 4)}
                    </Text>
                    <Text fontSize="md" fontWeight="semibold" color={sparxColor}>SPARX</Text>
                  </HStack>
                </Skeleton>
                {minimumIgniteAmount !== null && (
                  <Text color={subtleTextColor} fontSize="xs" mt={1}>
                    (Minimum Required: {formatBigIntDisplay(minimumIgniteAmount, 18, 2)})
                  </Text>
                )}
              </Box>
              
              {/* Right column - XBURN Output & Ignite Button */}
              <Box>
                <VStack align="flex-start" spacing={1}>
                  <Text fontSize="sm" color={subtleTextColor} mb={1}>Estimated XBURN Output</Text>
                  <Skeleton isLoaded={!isLoading}>
                    <VStack spacing={0} align="flex-start">
                      <HStack spacing={2} align="baseline">
                        <Text fontSize="xl" fontWeight="bold" color={xburnColor}>
                          {formatBigIntDisplay(xburnOutputEstimate, 18, 4)}
                        </Text>
                        <Text fontSize="md" fontWeight="semibold" color={xburnColor}>XBURN</Text>
                      </HStack>
                      <Text fontSize="xs" color={subtleTextColor}>
                        {estimatedUsdValue}
                      </Text>
                    </VStack>
                  </Skeleton>
                </VStack>
              </Box>
            </Grid>

            <Divider borderColor={borderColor} my={2} />

            {/* Conversion Path Section */}
            <Flex align="center" justify="center" p={3} bg={darkInputBg} borderRadius="md">
              <Text fontWeight="medium" fontSize="sm" color={sparxColor}>SPARX</Text>
              <Icon as={FaArrowRight} color={primaryColor} mx={4} />
              <Text fontWeight="medium" fontSize="sm" color={xburnColor}>XBURN</Text>
            </Flex>

            {/* Conversion Rate */}
            <DataRow label="Conversion Rate" labelColor={subtleTextColor} valueColor={lightTextColor}>
              <HStack spacing={1}>
                <Text fontWeight="medium">1 SPARX</Text>
                <Icon as={FaExchangeAlt} color={primaryColor} boxSize="14px" mx={1} />
                <Text fontWeight="medium">{exchangeRate} XBURN</Text>
              </HStack>
            </DataRow>

            <Divider borderColor={borderColor} my={2} />

            {/* Ignite Button - Match StakingPoolCard button style */}
            <Button
              bg={buttonBrown}
              color="white"
              _hover={{ bg: buttonBrownHover }}
              onClick={handleIgnite}
              isLoading={isTxLoading}
              isDisabled={isTxLoading || isLoading || !isMinimumMet}
              size="lg"
              fontSize="lg"
              fontWeight="bold"
              height="50px"
              w="full"
              leftIcon={<Box position="relative" animation={`${flicker} 2s infinite ease-in-out`}><FireIcon color="yellow.200" /></Box>}
              borderRadius="md"
            >
              {isTxLoading ? <Spinner size="sm" /> : 'Ignite SPARX'}
            </Button>

            {/* Status Message */}
            {!isMinimumMet && availableToBurn !== null && minimumIgniteAmount !== null && (
              <Text fontSize="sm" color={warningColor} textAlign="center">
                Minimum ignite amount of {formatBigIntDisplay(minimumIgniteAmount, 18, 2)} SPARX not met.
              </Text>
            )}

            {isMinimumMet && (
              <Text fontSize="sm" color={lightTextColor} textAlign="center">
                Ready to ignite! Click the button above to burn SPARX and Buy and Burn XBURN tokens.
              </Text>
            )}
          </VStack>
        </Box>

        {/* Information Card */}
        <Card bg="#1a202c" borderColor="gray.700" variant="outline" mt={6} overflow="hidden">
          <CardBody p={6}>
            <VStack spacing={6} align="center">
              {/* XBURN Logo Mascot */}
              <Box mb={2}>
                <Image 
                  src="/sparx-xburn-mat.png" 
                  alt="XBURN Mascot" 
                  width="200px"
                  height="200px"
                  objectFit="contain"
                />
              </Box>
              
              {/* Information Sections - Side by Side */}
              <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={{ base: 6, md: 10 }} w="full" maxW="900px">
                {/* Igniter Mechanics Section */}
                <Box>
                  <Flex align="center" mb={4}>
                    <Icon as={FaFire} color="#FF6937" boxSize={5} mr={2} />
                    <Heading size="md" color="#FF6937">Igniter Mechanics</Heading>
                  </Flex>
                  
                  <Text fontSize="sm" color="gray.200" mb={4} pl={1}>
                    The Sparx Igniter burns SPARX to Buy and Burn XBURN tokens:
                  </Text>
                  
                  <List spacing={3} pl={1}>
                    <ListItem color="gray.200" fontSize="sm" display="flex">
                      <Text as="span" mr={2}>•</Text>
                      <Text>Gives the caller a 5% reward in SPARX</Text>
                    </ListItem>
                    <ListItem color="gray.200" fontSize="sm" display="flex">
                      <Text as="span" mr={2}>•</Text>
                      <Text>Swaps 50% of remaining SPARX to XBURN</Text>
                    </ListItem>
                    <ListItem color="gray.200" fontSize="sm" display="flex">
                      <Text as="span" mr={2}>•</Text>
                      <Text>Burns both the swapped XBURN and remaining SPARX</Text>
                    </ListItem>
                  </List>
                </Box>
                
                {/* Benefits Section */}
                <Box>
                  <Flex align="center" mb={4}>
                    <Icon as={FaExchangeAlt} color="#38bdf8" boxSize={5} mr={2} />
                    <Heading size="md" color="#38bdf8">Burning Benefits</Heading>
                  </Flex>
                  
                  <Text fontSize="sm" color="gray.200" mb={4} pl={1}>
                    Regular burning provides multiple benefits:
                  </Text>
                  
                  <List spacing={3} pl={1}>
                    <ListItem color="gray.200" fontSize="sm" display="flex">
                      <Text as="span" mr={2}>•</Text>
                      <Text>Reduces SPARX supply improving tokenomics</Text>
                    </ListItem>
                    <ListItem color="gray.200" fontSize="sm" display="flex">
                      <Text as="span" mr={2}>•</Text>
                      <Text>Creates sustainable deflationary pressure</Text>
                    </ListItem>
                    <ListItem color="gray.200" fontSize="sm" display="flex">
                      <Text as="span" mr={2}>•</Text>
                      <Text>Rewards ignitors with SPARX incentives</Text>
                    </ListItem>
                  </List>
                </Box>
              </Grid>
            </VStack>
          </CardBody>
        </Card>
      </VStack>
    </Box>
  );
}

export default BurnerTab; 