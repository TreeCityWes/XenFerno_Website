import {
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  Stat,
  StatLabel,
  StatNumber,
  Text,
  VStack,
  useColorModeValue,
  Divider,
  Skeleton,
  Badge,
  Collapse,
  Tabs, TabList, TabPanels, Tab, TabPanel,
  InputGroup, InputLeftAddon, Input, InputRightAddon,
  FormControl, FormLabel, FormHelperText,
  useToast,
  Alert, AlertIcon,
  SimpleGrid,
  Spacer,
  Grid,
  Link,
  Icon,
  Image,
} from '@chakra-ui/react'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { FaPlus, FaMinus, FaExternalLinkAlt, FaWallet, FaExchangeAlt } from 'react-icons/fa'
import { LiquidityPool } from './types'
import { getAddressesForChain, Addresses, isContractDeployed } from '../../config/contracts'
import erc20Abi from '../../abis/ERC20.json' with { type: 'json' }
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useBalance } from 'wagmi'
import { formatUnits, parseUnits, maxUint256, type Abi, Address, BaseError, zeroAddress } from 'viem'
import { useCountdown } from '../../hooks/useCountdown'

// Import token logos
import sparxLogo from '../../assets/sparx-circle-logo.png'
import cbxenLogo from '../../assets/cbxen-circle-logo.png'
import xburnLogo from '../../assets/xenburn.png'

// Define minimal UniswapV2 Router ABI for interactions
const uniswapRouterAbi = [
  {
    "inputs": [
      { "internalType": "address", "name": "tokenA", "type": "address" },
      { "internalType": "address", "name": "tokenB", "type": "address" },
      { "internalType": "uint256", "name": "amountADesired", "type": "uint256" },
      { "internalType": "uint256", "name": "amountBDesired", "type": "uint256" },
      { "internalType": "uint256", "name": "amountAMin", "type": "uint256" },
      { "internalType": "uint256", "name": "amountBMin", "type": "uint256" },
      { "internalType": "address", "name": "to", "type": "address" },
      { "internalType": "uint256", "name": "deadline", "type": "uint256" }
    ],
    "name": "addLiquidity",
    "outputs": [
      { "internalType": "uint256", "name": "amountA", "type": "uint256" },
      { "internalType": "uint256", "name": "amountB", "type": "uint256" },
      { "internalType": "uint256", "name": "liquidity", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "token", "type": "address" },
      { "internalType": "uint256", "name": "amountTokenDesired", "type": "uint256" },
      { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" },
      { "internalType": "uint256", "name": "amountETHMin", "type": "uint256" },
      { "internalType": "address", "name": "to", "type": "address" },
      { "internalType": "uint256", "name": "deadline", "type": "uint256" }
    ],
    "name": "addLiquidityETH",
    "outputs": [
      { "internalType": "uint256", "name": "amountToken", "type": "uint256" },
      { "internalType": "uint256", "name": "amountETH", "type": "uint256" },
      { "internalType": "uint256", "name": "liquidity", "type": "uint256" }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "tokenA", "type": "address" },
      { "internalType": "address", "name": "tokenB", "type": "address" },
      { "internalType": "uint256", "name": "liquidity", "type": "uint256" },
      { "internalType": "uint256", "name": "amountAMin", "type": "uint256" },
      { "internalType": "uint256", "name": "amountBMin", "type": "uint256" },
      { "internalType": "address", "name": "to", "type": "address" },
      { "internalType": "uint256", "name": "deadline", "type": "uint256" }
    ],
    "name": "removeLiquidity",
    "outputs": [
      { "internalType": "uint256", "name": "amountA", "type": "uint256" },
      { "internalType": "uint256", "name": "amountB", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "token", "type": "address" },
      { "internalType": "uint256", "name": "liquidity", "type": "uint256" },
      { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" },
      { "internalType": "uint256", "name": "amountETHMin", "type": "uint256" },
      { "internalType": "address", "name": "to", "type": "address" },
      { "internalType": "uint256", "name": "deadline", "type": "uint256" }
    ],
    "name": "removeLiquidityETH",
    "outputs": [
      { "internalType": "uint256", "name": "amountToken", "type": "uint256" },
      { "internalType": "uint256", "name": "amountETH", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

// Type the ABI correctly
const routerAbiTyped = uniswapRouterAbi as Abi;
const erc20AbiDirect = erc20Abi as Abi;

// Helper function to map token symbols to known addresses
const getTokenAddress = (symbol: string, currentAddresses: Addresses): Address | undefined => {
  const mapping: Record<string, string | undefined> = {
    // 'cbXEN': currentAddresses.XEN, // Removed XEN
    'XBURN': currentAddresses.xburn, // Use lowercase xburn
    // 'WETH': currentAddresses.WETH, // Removed WETH
    'SPARX': currentAddresses.sparx
  };
  const address = mapping[symbol];
  return address && isContractDeployed(address) ? address as Address : undefined;
};

const DECIMALS = 18; // Assume standard 18 decimals for calculations
const DISPLAY_DECIMALS = 6; // Increased display decimals for more precision

// Helper function to get token logo URL
const getTokenLogo = (token1: string, token2: string): string => {
  // cbXEN/XBURN pair - use cbXEN logo (case insensitive)
  if (token1.toUpperCase() === 'CBXEN' || token2.toUpperCase() === 'CBXEN') {
    return '/cbxen-circle-logo.png';
  }
  
  // SPARX/WETH and XBURN/SPARX pairs - use SPARX logo (only if not paired with cbXEN)
  if ((token1 === 'SPARX' && token2.toUpperCase() !== 'CBXEN') || 
      (token2 === 'SPARX' && token1.toUpperCase() !== 'CBXEN')) {
    return '/sparx-circle-logo.png';
  }

  // XBURN/WETH pair - use XBURN logo
  if ((token1 === 'XBURN' && token2 === 'WETH') || (token2 === 'XBURN' && token1 === 'WETH')) {
    return '/logo192.png';
  }

  // Default to SPARX logo if no match
  return '/sparx-circle-logo.png';
};

interface PoolCardProps {
  pool: LiquidityPool;
  loading: boolean;
  onSuccessfulTx: () => void;
}

const PoolCard: React.FC<PoolCardProps> = ({ pool, loading, onSuccessfulTx }) => {
  const [manageMode, setManageMode] = useState<'add' | 'remove' | null>(null)
  const [amountToken1, setAmountToken1] = useState<string>('')
  const [amountToken2, setAmountToken2] = useState<string>('')
  const [amountLp, setAmountLp] = useState<string>('')
  const [activeInput, setActiveInput] = useState<'token1' | 'token2'>('token1'); // Track which input was last typed into

  const { address: userAddress, chain } = useAccount();
  const toast = useToast();

  const currentAddresses = useMemo(() => getAddressesForChain(chain?.id), [chain?.id]);

  const uniswapRouterAddress = useMemo(() => {
      const routerAddr = currentAddresses.router;
      return routerAddr && isContractDeployed(routerAddr) ? routerAddr as Address : zeroAddress;
  }, [currentAddresses]);

  // --- Transaction Hooks ---
  const { data: hash, error: writeError, isPending, writeContract } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, error: confirmationError } = useWaitForTransactionReceipt({ hash });
  const isTxLoading = isPending || isConfirming;

  // --- Derived State & Formatting ---
  const poolToken1Address = useMemo(() => getTokenAddress(pool.token1, currentAddresses), [pool.token1, currentAddresses]);
  const poolToken2Address = useMemo(() => getTokenAddress(pool.token2, currentAddresses), [pool.token2, currentAddresses]);
  const sepoliaWethAddress = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'; // Define Sepolia WETH directly
  const isWethPair = useMemo(() => 
    poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() || 
    poolToken2Address?.toLowerCase() === sepoliaWethAddress.toLowerCase(), 
  [poolToken1Address, poolToken2Address]);

  // Get reserve values from the updated pool data
  // Correctly assign reserves based on token order
  const { reserve1BigInt, reserve2BigInt } = useMemo(() => {
      const token1IsToken0 = pool.token0Address?.toLowerCase() === poolToken1Address?.toLowerCase();
      if (token1IsToken0) {
          return { reserve1BigInt: pool.reserve0Raw, reserve2BigInt: pool.reserve1Raw };
      } else {
          return { reserve1BigInt: pool.reserve1Raw, reserve2BigInt: pool.reserve0Raw };
      }
  }, [pool.reserve0Raw, pool.reserve1Raw, pool.token0Address, poolToken1Address]);

  const formatBigInt = useCallback((value: bigint | null | undefined, decimals = DECIMALS, displayDecimals = DISPLAY_DECIMALS) => {
    if (value === null || typeof value === 'undefined') return '0.00';
    const formatted = formatUnits(value, decimals);
    // Improved formatting to handle potential floating point inaccuracies and ensure desired decimal places
    const [integerPart, fractionalPart = ''] = formatted.split('.');
    return `${integerPart}.${fractionalPart.slice(0, displayDecimals).padEnd(displayDecimals, '0')}`; 
  }, []);

  // Fetch Native ETH balance if it's a WETH pair
  const { data: ethBalanceData } = useBalance({ 
      address: userAddress,
      query: { enabled: isWethPair && !!userAddress } // Only fetch if it's a WETH pair and user is connected
  });
  const nativeEthBalance = useMemo(() => ethBalanceData?.value, [ethBalanceData]);
  const nativeEthBalanceFormatted = useMemo(() => formatBigInt(nativeEthBalance), [nativeEthBalance, formatBigInt]);

  const userLpBalanceFormatted = useMemo(() => formatBigInt(pool.userLpBalance), [pool.userLpBalance, formatBigInt]);
  // Use native ETH balance if token is WETH, otherwise use ERC20 balance from props
  const userToken1BalanceToDisplay = useMemo(() => 
      poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? nativeEthBalance : pool.userToken1Balance, 
  [poolToken1Address, nativeEthBalance, pool.userToken1Balance]);
  const userToken2BalanceToDisplay = useMemo(() => 
      poolToken2Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? nativeEthBalance : pool.userToken2Balance, 
  [poolToken2Address, nativeEthBalance, pool.userToken2Balance]);
  
  const userToken1BalanceFormatted = useMemo(() => formatBigInt(userToken1BalanceToDisplay), [userToken1BalanceToDisplay, formatBigInt]);
  const userToken2BalanceFormatted = useMemo(() => formatBigInt(userToken2BalanceToDisplay), [userToken2BalanceToDisplay, formatBigInt]);

  // Format reserves for display directly from the raw bigint properties
  const reserve1Formatted = useMemo(() => formatBigInt(reserve1BigInt), [reserve1BigInt, formatBigInt]);
  const reserve2Formatted = useMemo(() => formatBigInt(reserve2BigInt), [reserve2BigInt, formatBigInt]);
  const token0Symbol = useMemo(() => pool.token0Address?.toLowerCase() === poolToken1Address?.toLowerCase() ? pool.token1 : pool.token2, [pool.token0Address, poolToken1Address, pool.token1, pool.token2]);
  const token1Symbol = useMemo(() => pool.token0Address?.toLowerCase() === poolToken1Address?.toLowerCase() ? pool.token2 : pool.token1, [pool.token0Address, poolToken1Address, pool.token1, pool.token2]);

  // Format percentage with 2 decimal places
  const formatPercentage = (value: number | null): string => {
    if (value === null || isNaN(value)) return '0.00%';
    return `${value.toFixed(2)}%`;
  };

  // Calculate user's share of the pool
  const userShareFormatted = formatPercentage(pool.userShare);

  // Get block explorer URL based on chain
  const getExplorerUrl = useCallback(() => {
    // For Sepolia testnet
    return `https://sepolia.etherscan.io/address/${pool.address}`;
  }, [pool.address]);

  // --- Input Handling & Quote Logic ---
  const handleAmount1Change = (value: string) => {
    setActiveInput('token1');
    setAmountToken1(value);
    // Ensure reserves are loaded, non-null, and non-zero before calculating
    if (reserve1BigInt && reserve2BigInt && reserve1BigInt > 0n) { 
      try {
        const amount1Parsed = parseUnits(value || '0', DECIMALS);
        const requiredAmount2 = (amount1Parsed * reserve2BigInt) / reserve1BigInt;
        setAmountToken2(formatUnits(requiredAmount2, DECIMALS));
      } catch { setAmountToken2('0'); /* Handle invalid input */ }
    }
  };

  const handleAmount2Change = (value: string) => {
    setActiveInput('token2');
    setAmountToken2(value);
    // Ensure reserves are loaded, non-null, and non-zero before calculating
    if (reserve1BigInt && reserve2BigInt && reserve2BigInt > 0n) { 
      try {
        const amount2Parsed = parseUnits(value || '0', DECIMALS);
        const requiredAmount1 = (amount2Parsed * reserve1BigInt) / reserve2BigInt;
        setAmountToken1(formatUnits(requiredAmount1, DECIMALS));
      } catch { setAmountToken1('0'); /* Handle invalid input */ }
    }
  };

  // --- Approve Logic ---
  const handleApprove = (tokenAddress: Address | undefined) => {
      if (!tokenAddress) return;
      writeContract({
          address: tokenAddress,
          abi: erc20AbiDirect,
          functionName: 'approve',
          args: [uniswapRouterAddress, maxUint256],
      });
  };

  // --- Add Liquidity Logic ---
  const handleAddLiquidity = () => {
    console.log("handleAddLiquidity triggered"); // Add log
    if (!userAddress || !poolToken1Address || !poolToken2Address) {
      console.log("handleAddLiquidity aborted: Missing addresses");
      return;
    }

    try {
        const amount1Parsed = parseUnits(amountToken1 || '0', DECIMALS);
        const amount2Parsed = parseUnits(amountToken2 || '0', DECIMALS);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 min deadline

        // TODO: Add slippage calculation for amountMin
        const amount1Min = amount1Parsed * 98n / 100n; // Example: 2% slippage
        const amount2Min = amount2Parsed * 98n / 100n; // Example: 2% slippage

        if (isWethPair) {
            // Check against sepoliaWethAddress
            const tokenAddress = poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? poolToken2Address : poolToken1Address;
            const tokenAmountDesired = poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? amount2Parsed : amount1Parsed;
            const ethAmountDesired = poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? amount1Parsed : amount2Parsed;
            const tokenAmountMin = poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? amount2Min : amount1Min;
            const ethAmountMin = poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? amount1Min : amount2Min;
            
            // Ensure tokenAddress is defined before calling contract
            if (!tokenAddress) {
                 console.error("Add liquidity error: Could not determine non-WETH token address.");
                 toast({ title: "Error", description: "Could not determine token address for ETH pair.", status: "error" });
                 return;
            }

            writeContract({
                address: uniswapRouterAddress,
                abi: routerAbiTyped,
                functionName: 'addLiquidityETH',
                args: [tokenAddress, tokenAmountDesired, tokenAmountMin, ethAmountMin, userAddress, deadline],
                value: ethAmountDesired,
            });
        } else {
            writeContract({
                address: uniswapRouterAddress,
                abi: routerAbiTyped,
                functionName: 'addLiquidity',
                args: [poolToken1Address, poolToken2Address, amount1Parsed, amount2Parsed, amount1Min, amount2Min, userAddress, deadline],
            });
        }
    } catch (e) {
        console.error("Add liquidity error:", e);
        toast({ title: "Error preparing transaction", description: (e as Error).message, status: "error", duration: 5000, isClosable: true });
    }
  };

  // --- Remove Liquidity Logic ---
  const handleRemoveLiquidity = () => {
     if (!userAddress || !poolToken1Address || !poolToken2Address) {
        console.log("handleRemoveLiquidity aborted: Missing addresses");
        return;
    }

    try {
        const lpAmountParsed = parseUnits(amountLp || '0', DECIMALS);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

        // TODO: Add slippage calculation for amountMin
        const amount1Min = 0n; // Set to 0 for now, needs calculation based on reserves/share
        const amount2Min = 0n; // Set to 0 for now

         if (isWethPair) {
            // Check against sepoliaWethAddress
            const tokenAddress = poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? poolToken2Address : poolToken1Address;
            const tokenAmountMin = poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? amount2Min : amount1Min;
            const ethAmountMin = poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? amount1Min : amount2Min;
            
            // Ensure tokenAddress is defined
             if (!tokenAddress) {
                 console.error("Remove liquidity error: Could not determine non-WETH token address.");
                 toast({ title: "Error", description: "Could not determine token address for ETH pair.", status: "error" });
                 return;
            }

            writeContract({
                address: uniswapRouterAddress,
                abi: routerAbiTyped,
                functionName: 'removeLiquidityETH',
                args: [tokenAddress, lpAmountParsed, tokenAmountMin, ethAmountMin, userAddress, deadline],
            });
        } else {
            writeContract({
                address: uniswapRouterAddress,
                abi: routerAbiTyped,
                functionName: 'removeLiquidity',
                args: [poolToken1Address, poolToken2Address, lpAmountParsed, amount1Min, amount2Min, userAddress, deadline],
            });
        }
    } catch (e) {
        console.error("Remove liquidity error:", e);
        toast({ title: "Error preparing transaction", description: (e as Error).message, status: "error", duration: 5000, isClosable: true });
    }
  };

  // --- Effects ---
  // Reset amounts when manage mode changes
  useEffect(() => {
    setAmountToken1('');
    setAmountToken2('');
    setAmountLp('');
  }, [manageMode]);

  // Show transaction feedback
  useEffect(() => {
    if (isConfirmed) {
      toast({ title: "Transaction Confirmed", description: "Liquidity updated successfully.", status: "success", duration: 5000, isClosable: true });
      onSuccessfulTx(); // Refresh data
      setManageMode(null); // Close management panel
    }
    if (writeError) {
      const message = writeError instanceof BaseError ? writeError.shortMessage : writeError.message;
      toast({ title: "Transaction Error", description: message, status: "error", duration: 7000, isClosable: true });
    }
     if (confirmationError) {
      const message = confirmationError instanceof BaseError ? confirmationError.shortMessage : confirmationError.message;
      toast({ title: "Confirmation Error", description: message, status: "error", duration: 7000, isClosable: true });
    }
  }, [isConfirmed, writeError, confirmationError, toast, onSuccessfulTx]);

  // Check allowances
  const needsApprovalToken1 = useMemo(() => {
      // Check against sepoliaWethAddress
      if (!poolToken1Address || poolToken1Address.toLowerCase() === sepoliaWethAddress.toLowerCase() || !pool.token1Allowance) return false;
      try {
          const amount1Parsed = parseUnits(amountToken1 || '0', DECIMALS);
          return amount1Parsed > 0n && pool.token1Allowance < amount1Parsed;
      } catch { return false; }
  }, [amountToken1, pool.token1Allowance, poolToken1Address]); // Removed wethAddress dependency

  const needsApprovalToken2 = useMemo(() => {
      // Check against sepoliaWethAddress
      if (!poolToken2Address || poolToken2Address.toLowerCase() === sepoliaWethAddress.toLowerCase()) return false; // No approval needed for WETH
      const allowance = pool.token2Allowance; // Use allowance from pool prop
      if (allowance === null || allowance === undefined) return true; // Needs loading or failed to load, assume approval needed
       try {
          const amount2Parsed = parseUnits(amountToken2 || '0', DECIMALS);
          return amount2Parsed > 0n && allowance < amount2Parsed;
      } catch { return false; }
  }, [amountToken2, pool.token2Allowance, poolToken2Address]); // Removed wethAddress dependency

   const needsApprovalLp = useMemo(() => {
      if (!pool.lpTokenAllowance) return false;
       try {
          const lpAmountParsed = parseUnits(amountLp || '0', DECIMALS);
          return lpAmountParsed > 0n && pool.lpTokenAllowance < lpAmountParsed;
      } catch { return false; }
  }, [amountLp, pool.lpTokenAllowance]);

  // Get logo for the pool
  const poolLogo = useMemo(() => getTokenLogo(pool.token1, pool.token2), [pool.token1, pool.token2]);

  // --- Debug Log --- 
  useEffect(() => {
    console.log(`PoolCard Render [${pool.name}] - PID: ${pool.pid}, Loading: ${loading}`);
    console.log(`  Reserves Raw: ${pool.reserve0Raw}, ${pool.reserve1Raw}`);
    console.log(`  Reserves BigInt: ${reserve1BigInt}, ${reserve2BigInt}`);
    console.log(`  User LP Balance: ${pool.userLpBalance}`);
  }, [pool, loading, reserve1BigInt, reserve2BigInt]);

  // --- Render ---
  return (
    <Box
      bg='gray.800'
      borderRadius="xl"
      border="1px"
      borderColor='gray.700'
      p={6}
      position="relative"
      _hover={{ borderColor: 'brand.500', transition: 'all 0.2s' }}
    >
      {/* Header */}
      <VStack spacing={4} align="stretch">
        <Flex justify="space-between" align="center">
          <HStack spacing={3}>
            <Image 
              src={poolLogo} 
              alt={`${pool.name} logo`}
              boxSize="40px"
              objectFit="contain"
              borderRadius="full"
            />
            <Heading size="md" color="brand.500">{pool.name}</Heading>
            <Badge colorScheme="gray" variant="outline" fontSize="xs">PID: {pool.pid}</Badge>
            <Link href={getExplorerUrl()} isExternal>
              <Icon as={FaExternalLinkAlt} color="gray.400" _hover={{ color: 'brand.500' }} />
            </Link>
          </HStack>
          {pool.apr !== null && (
            <Badge colorScheme="brand" fontSize="md" px={3} py={1}>
              APR: {formatPercentage(pool.apr)}
            </Badge>
          )}
        </Flex>

        {/* Stats Grid */}
        <SimpleGrid columns={2} spacing={4}>
          {/* Your LP Tokens */}
          <Box 
            bg='gray.700'
            p={4} 
            borderRadius="lg"
            border="1px"
            borderColor='gray.700'
          >
            <HStack mb={2}>
              <Icon as={FaWallet} color="brand.500" />
              <Text fontSize="sm" color="gray.400">Your LP Tokens</Text>
            </HStack>
            <Skeleton isLoaded={!loading}>
              <Text fontSize="lg" fontWeight="bold" color="white">
                {userLpBalanceFormatted}
              </Text>
              <Text fontSize="sm" color="gray.400">
                Share: {userShareFormatted}
              </Text>
            </Skeleton>
          </Box>

          {/* Pool Reserves */}
          <Box 
            bg='gray.700'
            p={4} 
            borderRadius="lg"
            border="1px"
            borderColor='gray.700'
          >
            <HStack mb={2}>
              <Icon as={FaExchangeAlt} color="brand.500" />
              <Text fontSize="sm" color="gray.400">Pool Reserves</Text>
            </HStack>
            <Skeleton isLoaded={!loading && reserve1BigInt !== null && reserve2BigInt !== null}>
              <Text fontSize="sm" color="white" mb={1}>
                {reserve1Formatted} {token0Symbol}
              </Text>
              <Text fontSize="sm" color="white">
                {reserve2Formatted} {token1Symbol}
              </Text>
            </Skeleton>
          </Box>
        </SimpleGrid>

        <Divider borderColor='gray.700' />

        {/* Action Buttons */}
        <HStack mt={2} width="100%" spacing={4}>
          <Button
            leftIcon={<FaPlus />}
            colorScheme="brand"
            _hover={{ transform: 'translateY(-2px)' }}
            onClick={() => setManageMode('add')}
            flex={1}
            isDisabled={isTxLoading}
            height="48px"
            transition="all 0.2s"
            fontSize="lg"
          >
            Add Liquidity
          </Button>
          <Button
            leftIcon={<FaMinus />}
            colorScheme="red"
            _hover={{ transform: 'translateY(-2px)' }}
            onClick={() => setManageMode('remove')}
            flex={1}
            isDisabled={isTxLoading || !pool.userLpBalance || pool.userLpBalance === 0n}
            height="48px"
            transition="all 0.2s"
            fontSize="lg"
          >
            Remove Liquidity
          </Button>
        </HStack>

        {/* Add/Remove Liquidity Panel */}
        <Collapse in={manageMode !== null} animateOpacity>
          <Box p={5} mt={4} bg='gray.700' borderRadius="md">
            {manageMode === 'add' && (
              <VStack spacing={4} align="stretch">
                <Heading size="sm" color="brand.500">Add Liquidity</Heading>
                {/* Token 1 Input */}
                <FormControl>
                    <Flex justify="space-between" mb={1}>
                      {/* Show ETH if token1 is WETH */}
                      <FormHelperText color="gray.400">{poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? 'ETH' : pool.token1} Amount</FormHelperText>
                      <FormHelperText color="gray.300">Balance: {userToken1BalanceFormatted}</FormHelperText>
                    </Flex>
                    <InputGroup>
                        <Input 
                            id={`token1-${pool.address}`}
                            type="number" 
                            placeholder="0.0" 
                            value={amountToken1} 
                            onChange={(e) => handleAmount1Change(e.target.value)} 
                            isDisabled={isTxLoading}
                            bg='gray.900'
                            borderColor='gray.700'
                            color="white"
                            _focus={{ borderColor: 'brand.500' }}
                            _hover={{ borderColor: 'gray.500' }}
                        />
                        <InputRightAddon bg='gray.900' borderColor='gray.700' p={0}>
                            <Button 
                              h="full"
                              size="sm" 
                              bg="transparent"
                              color='brand.500'
                              borderLeftColor='gray.700'
                              _hover={{ bg: 'gray.700' }}
                              isDisabled={isTxLoading}
                              onClick={() => handleAmount1Change(formatUnits(userToken1BalanceToDisplay ?? 0n, DECIMALS))}
                            >
                              MAX
                            </Button>
                        </InputRightAddon>
                    </InputGroup>
                </FormControl>

                {/* Token 2 Input */}
                 <FormControl>
                    <Flex justify="space-between" mb={1}>
                      {/* Show ETH if token2 is WETH */}
                      <FormHelperText color="gray.400">{poolToken2Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? 'ETH' : pool.token2} Amount</FormHelperText>
                      <FormHelperText color="gray.300">Balance: {userToken2BalanceFormatted}</FormHelperText>
                    </Flex>
                    <InputGroup>
                        <Input 
                            id={`token2-${pool.address}`}
                            type="number" 
                            placeholder="0.0" 
                            value={amountToken2} 
                            onChange={(e) => handleAmount2Change(e.target.value)} 
                            isDisabled={isTxLoading}
                            bg='gray.900'
                            borderColor='gray.700'
                            color="white"
                            _focus={{ borderColor: 'brand.500' }}
                            _hover={{ borderColor: 'gray.500' }}
                        />
                        <InputRightAddon bg='gray.900' borderColor='gray.700' p={0}>
                            <Button 
                              h="full"
                              size="sm" 
                              bg="transparent"
                              color='brand.500'
                              borderLeftColor='gray.700'
                              _hover={{ bg: 'gray.700' }}
                              isDisabled={isTxLoading}
                              onClick={() => handleAmount2Change(formatUnits(userToken2BalanceToDisplay ?? 0n, DECIMALS))}
                            >
                              MAX
                            </Button>
                        </InputRightAddon>
                    </InputGroup>
                </FormControl>

                {/* Action Buttons (Approve/Add) */}
                <HStack>
                    {(needsApprovalToken1 || needsApprovalToken2) && (
                        <Button 
                            colorScheme="yellow"
                            onClick={() => handleApprove(needsApprovalToken1 ? poolToken1Address : poolToken2Address)} 
                            isLoading={isTxLoading && hash !== null}
                            isDisabled={isTxLoading}
                            flex={1}
                        >
                            Approve {needsApprovalToken1 ? pool.token1 : pool.token2}
                        </Button>
                    )}
                     {!needsApprovalToken1 && !needsApprovalToken2 && (
                        <Button 
                            colorScheme="brand"
                            onClick={handleAddLiquidity} 
                            isLoading={isTxLoading}
                            isDisabled={isTxLoading || uniswapRouterAddress === zeroAddress || !amountToken1 || !amountToken2 || parseFloat(amountToken1) <= 0 || parseFloat(amountToken2) <= 0}
                            flex={1}
                            size="lg"
                        >
                            Add Liquidity
                        </Button>
                    )}
                </HStack>
              </VStack>
            )}

            {manageMode === 'remove' && (
              <VStack spacing={4} align="stretch">
                 <Heading size="sm" color="red.500">Remove Liquidity</Heading>
                {/* LP Token Input */}
                <FormControl>
                    <Flex justify="space-between" mb={1}>
                      <FormHelperText color="gray.400">LP Token Amount</FormHelperText>
                      <FormHelperText color="gray.300">Balance: {userLpBalanceFormatted}</FormHelperText>
                    </Flex>
                    <InputGroup>
                        <Input 
                            id={`lp-${pool.address}`}
                            type="number" 
                            placeholder="0.0" 
                            value={amountLp} 
                            onChange={(e) => setAmountLp(e.target.value)} 
                            isDisabled={isTxLoading}
                            bg='gray.900'
                            borderColor='gray.700'
                            color="white"
                            _focus={{ borderColor: 'red.500' }}
                            _hover={{ borderColor: 'gray.500' }}
                        />
                        <InputRightAddon bg='gray.900' borderColor='gray.700' p={0}>
                            <Button 
                              h="full"
                              size="sm" 
                              bg="transparent"
                              color='brand.500'
                              borderLeftColor='gray.700'
                              _hover={{ bg: 'gray.700' }}
                              isDisabled={isTxLoading}
                              onClick={() => setAmountLp(formatUnits(pool.userLpBalance ?? 0n, DECIMALS))}
                            >
                              MAX
                            </Button>
                        </InputRightAddon>
                    </InputGroup>
                </FormControl>

                 {/* Action Buttons (Approve/Remove) */}
                 <HStack>
                     {needsApprovalLp && (
                         <Button 
                            colorScheme="yellow"
                            onClick={() => handleApprove(pool.address)} 
                            isLoading={isTxLoading && hash !== null}
                            isDisabled={isTxLoading}
                            flex={1}
                        >
                            Approve LP Tokens
                        </Button>
                     )}
                     {!needsApprovalLp && (
                        <Button 
                            colorScheme="red"
                            onClick={handleRemoveLiquidity} 
                            isLoading={isTxLoading}
                            isDisabled={isTxLoading || uniswapRouterAddress === zeroAddress || !amountLp || parseFloat(amountLp) <= 0}
                            flex={1}
                            size="lg"
                        >
                            Remove Liquidity
                        </Button>
                     )}
                 </HStack>
              </VStack>
            )}
          </Box>
        </Collapse>
      </VStack>
    </Box>
  )
}

export default PoolCard; 