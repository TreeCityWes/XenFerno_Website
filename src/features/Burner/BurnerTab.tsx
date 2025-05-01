import { Box, VStack, Heading, Text, Button, useToast, Spinner, Center, Input, SimpleGrid, Stat, StatLabel, StatNumber, StatHelpText, Skeleton, FormControl, FormLabel, FormHelperText, InputGroup, InputRightAddon, Alert, AlertIcon, AlertTitle, HStack, Divider, Icon, Flex } from '@chakra-ui/react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { getAddressesForChain, Addresses, isContractDeployed } from '../../config/contracts';
import burnerAbiJson from '../../abis/SparxBurner.json' with { type: 'json' };
import erc20Abi from '../../abis/ERC20.json' with { type: 'json' };
import { type Abi, formatUnits, parseUnits, maxUint256, BaseError, zeroAddress, Address } from 'viem';
import { sepolia, mainnet } from 'wagmi/chains';
import { FaFire, FaArrowRight, FaExchangeAlt } from 'react-icons/fa';
import { keyframes } from '@emotion/react';

// Type ABIs
const burnerAbiTyped = burnerAbiJson as Abi;
const erc20AbiDirect = erc20Abi as Abi; 

const burnRed = '#FF3A2F'; 

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

const formatBigIntDisplay = (value: bigint | null | undefined, decimals = 18, displayDecimals = 4) => {
    if (value === null || typeof value === 'undefined') return '0.0'.padEnd(displayDecimals + 2, '0');
    const formatted = formatUnits(value, decimals);
    const [integerPart, fractionalPart = ''] = formatted.split('.');
    return `${integerPart}.${fractionalPart.slice(0, displayDecimals).padEnd(displayDecimals, '0')}`;
};

// Add a visual path indicator component
const ConversionPath = ({ path, isAnimating }: { path: Address[] | null, isAnimating: boolean }) => {
  if (!path || path.length < 2) return null;
  
  return (
    <Box w="100%" p={4} bg="gray.800" borderRadius="lg" mb={4}>
      <Text fontSize="sm" color="gray.400" mb={2}>Conversion Path</Text>
      <Flex align="center" justify="center">
        <Box>
          <Text fontWeight="bold" color="orange.300">SPARX</Text>
          <Text fontSize="xs" color="gray.500" mt={1}>{path[0].substring(0, 6)}...{path[0].substring(38)}</Text>
        </Box>
        
        <Icon 
          as={FaArrowRight} 
          color="gray.500" 
          mx={4}
          animation={isAnimating ? `${flicker} 1s infinite` : 'none'}
        />
        
        <Box>
          <Text fontWeight="bold" color="yellow.300">XBURN</Text>
          <Text fontSize="xs" color="gray.500" mt={1}>{path[1].substring(0, 6)}...{path[1].substring(38)}</Text>
        </Box>
      </Flex>
    </Box>
  );
};

// Add a FireIcon component
const FireIcon = ({ size = "40px", isAnimating = false }) => (
  <Box 
    animation={isAnimating ? `${flicker} 1.5s infinite` : 'none'}
    display="flex"
    alignItems="center"
    justifyContent="center"
  >
    <Icon as={FaFire} w={size} h={size} color="red.500" />
  </Box>
);

function BurnerTab({ isActive }: TabProps) {
  const { address: userAddress, isConnected, chain } = useAccount();
  const toast = useToast();
  const [slippage, setSlippage] = useState<string>("0.5"); 
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

  // Function to fetch XBURN estimate based on SPARX amount
  const fetchXburnEstimate = useCallback(async (amount: bigint) => {
    if (!isConnected || !chain?.id || burnerAddress === zeroAddress || !amount || amount <= 0n) {
      return;
    }

    try {
      const { data } = await useReadContracts({
        contracts: [{
          address: burnerAddress,
          abi: burnerAbiTyped,
          functionName: 'estimateXBurnOut',
          args: [amount],
          chainId: chain.id
        }]
      });

      if (data && data[0]?.status === 'success') {
        setXburnOutputEstimate(data[0].result as bigint);
      }
    } catch (error) {
      console.error("Error estimating XBURN output:", error);
    }
  }, [isConnected, chain?.id, burnerAddress]);

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
        functionName: 'MINIMUM_IGNITE_AMOUNT',
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

  const { data: readResults, isLoading: isReadLoading, error: readError, refetch: refetchReads } = useReadContracts({
      contracts: contractsToRead,
      query: {
          enabled: isActive && isConnected && contractsToRead.length > 0,
      }
  });

  // --- Process Read Results ---
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

    // Fetch XBURN estimate if we have SPARX to burn
    if (sparxAmount && sparxAmount > 0n) {
      fetchXburnEstimate(sparxAmount);
    }
  }, [readResults, contractsToRead, fetchXburnEstimate]);

  // Derived state: Check if minimum ignite amount is met
  const isMinimumMet = useMemo(() => {
      if (availableToBurn === null || minimumIgniteAmount === null) return false;
      return minimumIgniteAmount !== null && availableToBurn >= minimumIgniteAmount;
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

    let slippageToleranceBasisPoints: bigint;
    try {
        slippageToleranceBasisPoints = BigInt(Math.floor(parseFloat(slippage) * 100));
        if (slippageToleranceBasisPoints <= 0n || slippageToleranceBasisPoints > 10000n) { 
            throw new Error("Slippage must be between 0.01% and 100%");
        }
    } catch {
         toast({ title: "Invalid Slippage", description: "Please enter a valid slippage percentage (e.g., 0.5).", status: "error" });
         return;
    }
    
     if (availableToBurn === null || availableToBurn < (minimumIgniteAmount ?? 0n)) {
         toast({ title: "Minimum Not Met", description: `Cannot ignite: Need at least ${formatBigIntDisplay(minimumIgniteAmount, 18, 2)} SPARX. Available: ${formatBigIntDisplay(availableToBurn, 18, 2)}`, status: "error" });
         return;
     }

    console.log("Calling ignite with customSlippagePercentage:", slippageToleranceBasisPoints);
    writeContract({
      address: burnerAddress,
      abi: burnerAbiTyped,
      functionName: 'ignite',
      args: [slippageToleranceBasisPoints], 
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
          <Text fontSize="lg">Connect your wallet to use the Sparx Burner</Text>
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

  return (
    <VStack align="stretch" spacing={6}>
      <Box>
        <Heading size="md" mb={2}>
          <HStack>
            <FireIcon size="24px" isAnimating={true} />
            <Text>Sparx Igniter</Text>
          </HStack>
        </Heading>
        <Text mb={4} color="gray.500">
          Ignite the accumulated SPARX in the burner contract to mint XBURN tokens.
        </Text>
      </Box>

      {readError && (
          <Alert status="error" borderRadius="md">
            <AlertIcon />
            <AlertTitle>Error fetching data: {readError instanceof BaseError ? readError.shortMessage : readError.message}</AlertTitle>
          </Alert>
      )}

      {/* Conversion Path Visualization */}
      <ConversionPath path={swapPath} isAnimating={isTxLoading} />

      {/* Stats Display */}
      <Box bg="gray.700" p={6} borderRadius="lg" borderWidth="1px" borderColor="gray.600">
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
          <Stat>
              <StatLabel color="gray.400" fontSize="md">SPARX Available to Ignite</StatLabel>
              <Skeleton isLoaded={!isLoading && availableToBurn !== null && minimumIgniteAmount !== null} minHeight="36px" mt={2}>
                  <StatNumber 
                      fontSize="3xl"
                      fontWeight="bold"
                      color={isMinimumMet ? "orange.300" : "red.400"} 
                      lineHeight="1.2"
                  >
                      {formatBigIntDisplay(availableToBurn, 18, 4)} SPARX
                  </StatNumber>
                  {minimumIgniteAmount !== null && (
                      <StatHelpText color="gray.500" fontSize="sm" mt={1}>
                          (Minimum Required: {formatBigIntDisplay(minimumIgniteAmount, 18, 2)})
                      </StatHelpText>
                  )}
              </Skeleton>
          </Stat>
              
          <Stat>
              <StatLabel color="gray.400" fontSize="md">Estimated XBURN Output</StatLabel>
              <Skeleton isLoaded={!isLoading && xburnOutputEstimate !== null} minHeight="36px" mt={2}>
                  <StatNumber 
                      fontSize="3xl"
                      fontWeight="bold"
                      color="green.400"
                      lineHeight="1.2"
                  >
                      {formatBigIntDisplay(xburnOutputEstimate, 18, 4)} XBURN
                  </StatNumber>
                  <StatHelpText color="gray.500" fontSize="sm" mt={1}>
                      (Based on current exchange rate)
                  </StatHelpText>
              </Skeleton>
          </Stat>
        </SimpleGrid>

        {/* Visual Conversion Rate */}
        <Box mt={6}>
          <Divider mb={4} />
          <HStack justify="center" spacing={4}>
            <VStack>
              <Text fontSize="sm" color="gray.400">1 SPARX</Text>
              <Box bg="orange.700" p={2} borderRadius="md">
                <Text fontWeight="bold" color="orange.200">SPARX</Text>
              </Box>
            </VStack>
            
            <Icon as={FaExchangeAlt} color="gray.500" />
            
            <VStack>
              <Text fontSize="sm" color="gray.400">
                {xburnOutputEstimate && availableToBurn ? 
                  `${(Number(formatUnits(xburnOutputEstimate, 18)) / Number(formatUnits(availableToBurn, 18))).toFixed(4)}` : 
                  '...'
                }
              </Text>
              <Box bg="yellow.700" p={2} borderRadius="md">
                <Text fontWeight="bold" color="yellow.200">XBURN</Text>
              </Box>
            </VStack>
          </HStack>
        </Box>
      </Box>
      
      {/* Action Area */}
      <VStack spacing={5} bg="gray.700" p={6} borderRadius="lg" borderWidth="1px" borderColor="gray.600" align="stretch">
         <FormControl id="slippage">
            <FormLabel fontSize="md" fontWeight="medium" color="gray.200">Slippage Tolerance</FormLabel>
             <InputGroup size="md">
                <Input
                    type="number"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    placeholder="0.5"
                    width="120px"
                    bg="gray.800"
                    borderColor="gray.600"
                    _hover={{ borderColor: "gray.500" }}
                    _focus={{ borderColor: "orange.400", boxShadow: "outline" }}
                />
                 <InputRightAddon bg="gray.600" borderColor="gray.600">%</InputRightAddon>
            </InputGroup>
            <FormHelperText fontSize="sm" color="gray.500" mt={2}>Recommended: 0.5% - 1%</FormHelperText>
        </FormControl>
        
        <Button
          bgGradient="linear(to-r, red.500, orange.400)"
          color="white"
          _hover={{ 
              bgGradient: "linear(to-r, red.600, orange.500)",
              boxShadow: "md" 
          }}
          _active={{ bgGradient: "linear(to-r, red.700, orange.600)" }}
          onClick={handleIgnite}
          isLoading={isTxLoading}
          isDisabled={isTxLoading || isLoading || !isMinimumMet} 
          size="lg"
          fontSize="xl"
          fontWeight="bold"
          py={6}
          w="full"
          leftIcon={<FireIcon size="24px" isAnimating={!isTxLoading} />}
        >
          {isTxLoading ? <Spinner /> : 'Ignite SPARX'}
        </Button>
        {!isMinimumMet && availableToBurn !== null && minimumIgniteAmount !== null && (
            <Text fontSize="md" color="yellow.400" textAlign="center">
                Minimum ignite amount of {formatBigIntDisplay(minimumIgniteAmount, 18, 2)} SPARX not met.
            </Text>
        )}
        {isTxLoading && <Text fontSize="md" color="gray.400" textAlign="center">Igniting... Transaction may take a moment.</Text>}
      </VStack>
    </VStack>
  );
}

export default BurnerTab; 