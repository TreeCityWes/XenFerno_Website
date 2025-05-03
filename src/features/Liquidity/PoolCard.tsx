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
import { sepolia } from 'wagmi/chains'

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
    'XBURN': currentAddresses.xburn,
    'SPARX': currentAddresses.sparx,
    'cbXEN': currentAddresses.cbxen,
    'WETH': sepolia.nativeCurrency.symbol === 'ETH' ? '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' : undefined
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
  const [pendingTxType, setPendingTxType] = useState<'approval' | 'liquidity' | null>(null); // State to track tx type

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
  const isTxLoading = isPending || isConfirming; // Combined loading state

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
      if (!tokenAddress) {
          console.error("Approval error: tokenAddress is undefined");
          toast({ title: "Error", description: "Token address is undefined", status: "error" });
          return;
      }
      
      // Get the exact amount user is trying to approve based on which token needs approval
      let amountToApprove: bigint;
      
      try {
          // Determine which token needs approval
          if (tokenAddress === poolToken1Address) {
              // Token 1 approval - exact amount user entered
              amountToApprove = parseUnits(amountToken1 || '0', DECIMALS);
          } else if (tokenAddress === poolToken2Address) {
              // Token 2 approval - exact amount user entered
              amountToApprove = parseUnits(amountToken2 || '0', DECIMALS);
          } else if (tokenAddress === pool.address) {
              // LP token approval for removing liquidity - exact amount user entered
              amountToApprove = parseUnits(amountLp || '0', DECIMALS);
          } else {
              // Fallback for edge cases - 1000 tokens
              amountToApprove = parseUnits('1000', DECIMALS);
          }
          
          // Only proceed if amount is greater than zero
          if (amountToApprove <= 0n) {
              toast({ title: "Invalid Amount", description: "Please enter an amount greater than zero", status: "warning" });
              return;
          }
          
          // Use maxUint256 for approval to avoid future approval issues
          const approvalAmount = maxUint256;
          
          // Logging for debugging
          console.log('--- Approving Token ---');
          console.log('Token Address:', tokenAddress);
          console.log('Router Address (spender):', uniswapRouterAddress);
          console.log('Original Amount:', formatUnits(amountToApprove, DECIMALS));
          console.log('Approval Amount:', 'Max Approval');
          
          // Indicate that an approval transaction is starting
          setPendingTxType('approval');
          
          writeContract({
              address: tokenAddress,
              abi: erc20AbiDirect,
              functionName: 'approve',
              args: [uniswapRouterAddress, approvalAmount],
          });
      } catch (error) {
          console.error("Error calculating approval amount:", error);
          toast({ title: "Error", description: "Failed to calculate approval amount", status: "error" });
      }
  };

  // --- Add Liquidity Logic ---
  const handleAddLiquidity = () => {
    console.log("handleAddLiquidity triggered"); 
    if (!userAddress || !poolToken1Address || !poolToken2Address) {
      console.log("handleAddLiquidity aborted: Missing addresses");
      return;
    }

    try {
        const amount1Parsed = parseUnits(amountToken1 || '0', DECIMALS);
        const amount2Parsed = parseUnits(amountToken2 || '0', DECIMALS);
        
        // Debug info for ETH pairs
        if (isWethPair) {
            console.log('--- ETH Pair Debug Info ---');
            console.log('Pool Name:', pool.name);
            console.log('Is WETH Pair:', isWethPair);
            console.log('Token1 Address:', poolToken1Address);
            console.log('Token2 Address:', poolToken2Address);
            console.log('WETH Address:', sepoliaWethAddress);
            console.log('Token1 is ETH:', poolToken1Address.toLowerCase() === sepoliaWethAddress.toLowerCase());
            console.log('Token2 is ETH:', poolToken2Address.toLowerCase() === sepoliaWethAddress.toLowerCase());
            console.log('Token1 Allowance:', pool.token1Allowance ? formatUnits(pool.token1Allowance, DECIMALS) : 'null');
            console.log('Token2 Allowance:', pool.token2Allowance ? formatUnits(pool.token2Allowance, DECIMALS) : 'null');
            console.log('Token1 Needs Approval:', needsApprovalToken1);
            console.log('Token2 Needs Approval:', needsApprovalToken2);
        }
        
        // Validate input amounts against balances
        if (poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase()) {
            // For ETH (Token1)
            if (nativeEthBalance && amount1Parsed > nativeEthBalance) {
                toast({ 
                    title: "Insufficient ETH Balance", 
                    description: `You have ${formatBigInt(nativeEthBalance)} ETH but entered ${amountToken1}`, 
                    status: "error" 
                });
                return;
            }
        } else if (pool.userToken1Balance && amount1Parsed > pool.userToken1Balance) {
            toast({ 
                title: `Insufficient ${pool.token1} Balance`, 
                description: `You have ${formatBigInt(pool.userToken1Balance)} ${pool.token1} but entered ${amountToken1}`, 
                status: "error" 
            });
            return;
        }
        
        if (poolToken2Address?.toLowerCase() === sepoliaWethAddress.toLowerCase()) {
            // For ETH (Token2)
            if (nativeEthBalance && amount2Parsed > nativeEthBalance) {
                toast({ 
                    title: "Insufficient ETH Balance", 
                    description: `You have ${formatBigInt(nativeEthBalance)} ETH but entered ${amountToken2}`, 
                    status: "error" 
                });
                return;
            }
        } else if (pool.userToken2Balance && amount2Parsed > pool.userToken2Balance) {
            toast({ 
                title: `Insufficient ${pool.token2} Balance`, 
                description: `You have ${formatBigInt(pool.userToken2Balance)} ${pool.token2} but entered ${amountToken2}`, 
                status: "error" 
            });
            return;
        }

        // Indicate that a liquidity transaction is starting
        setPendingTxType('liquidity');

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
            
            // Debug ETH pair specific transaction data
            console.log('--- ETH Pair Transaction Data ---');
            console.log('Token Address for addLiquidityETH:', tokenAddress);
            console.log('Token Amount Desired:', formatUnits(tokenAmountDesired, DECIMALS));
            console.log('ETH Amount Desired:', formatUnits(ethAmountDesired, DECIMALS)); 
            console.log('Token Amount Min:', formatUnits(tokenAmountMin, DECIMALS));
            console.log('ETH Amount Min:', formatUnits(ethAmountMin, DECIMALS));
            console.log('User Address:', userAddress);
            console.log('Deadline:', deadline.toString());

            // Double check if we need to approve the non-ETH token first
            // If there's a WETH pair and an approval was needed but no Approve button was shown
            if (needsApprovalToken1 || needsApprovalToken2) {
                console.log('WETH pair requires token approval first!');
                // Approval needed, handle it first
                const tokenToApprove = poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() 
                    ? poolToken2Address : poolToken1Address;
                
                toast({ 
                    title: "Approval Required", 
                    description: `Please approve your tokens before adding liquidity.`,
                    status: "warning" 
                });
                // Don't proceed, let user click approve first
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

  // Helper function to identify the SPARX/cbXEN LP pair
  const isSparxCbxenPair = (poolAddress: string): boolean => {
    // Get address from config instead of hardcoding
    const configuredAddress = currentAddresses.LP_SPARX_CBXEN as string;
    return poolAddress.toLowerCase() === configuredAddress.toLowerCase();
  };

  // Handle direct button click to open remove mode
  const handleRemoveClick = () => {
    setManageMode('remove');
  };

  // Handle the actual remove liquidity operation
  const handleRemoveLiquidity = () => {
    if (!userAddress || !poolToken1Address || !poolToken2Address) {
      console.log("handleRemoveLiquidity aborted: Missing addresses");
      return;
    }

    try {
      // Special handling for SPARX/cbXEN pair
      const useSpecialHandling = isSparxCbxenPair(pool.address);
      
      // Use the full amount requested (removed the 1% scaling)
      const lpAmountParsed = parseUnits(amountLp || '0', DECIMALS);
      
      // Validate LP amount against balance
      if (pool.userLpBalance && lpAmountParsed > pool.userLpBalance) {
        toast({ 
          title: "Insufficient LP Token Balance", 
          description: `You have ${formatBigInt(pool.userLpBalance)} LP tokens but entered ${amountLp}`, 
          status: "error" 
        });
        return;
      }
      
      const lpAmountToUse = lpAmountParsed;
      
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

      if (isWethPair) {
        // WETH pair handling
        const tokenAddress = poolToken1Address?.toLowerCase() === sepoliaWethAddress.toLowerCase() ? poolToken2Address : poolToken1Address;
        
        if (!tokenAddress) {
          console.error("Remove liquidity error: Could not determine non-WETH token address.");
          toast({ title: "Error", description: "Could not determine token address for ETH pair.", status: "error" });
          return;
        }
        
        console.log('--- Remove Liquidity (WETH Pair) ---');
        console.log('Pool:', pool.name);
        console.log('LP Amount:', lpAmountToUse.toString());
        
        writeContract({
          address: uniswapRouterAddress,
          abi: routerAbiTyped,
          functionName: 'removeLiquidityETH',
          args: [tokenAddress, lpAmountToUse, 0n, 0n, userAddress, deadline],
        });
      } else {
        // For non-WETH pairs
        let token0: Address;
        let token1: Address;
        
        if (useSpecialHandling) {
          // Use the CORRECT addresses from constants (get from current config)
          const sparxAddress = currentAddresses.sparx as Address;
          const cbxenAddress = currentAddresses.cbxen as Address;
          
          // Compare addresses to determine correct order (lexicographical)
          const [sortedToken0, sortedToken1] = cbxenAddress.toLowerCase() < sparxAddress.toLowerCase()
            ? [cbxenAddress, sparxAddress]
            : [sparxAddress, cbxenAddress];
            
          token0 = sortedToken0;
          token1 = sortedToken1;
          
          console.log('Using addresses from config for SPARX/cbXEN:');
          console.log('SPARX:', sparxAddress);
          console.log('cbXEN:', cbxenAddress);
          console.log('Sorted token0:', token0);
          console.log('Sorted token1:', token1);
        } else {
          // Sort addresses for other pairs
          const addr1 = poolToken1Address.toLowerCase();
          const addr2 = poolToken2Address.toLowerCase();
          
          [token0, token1] = addr1 < addr2 
            ? [poolToken1Address, poolToken2Address]
            : [poolToken2Address, poolToken1Address];
        }
        
        console.log('--- Remove Liquidity (Regular Pair) ---');
        console.log('Pool:', pool.name);
        console.log('Token0:', token0);
        console.log('Token1:', token1);
        console.log('LP Amount:', lpAmountToUse.toString());
        
        writeContract({
          address: uniswapRouterAddress,
          abi: routerAbiTyped,
          functionName: 'removeLiquidity',
          args: [token0, token1, lpAmountToUse, 0n, 0n, userAddress, deadline],
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
      // Explicitly handle based on the type of transaction that succeeded
      if (pendingTxType === 'approval') {
        toast({
          title: "Approval Confirmed",
          description: "Token approval successful. You can now proceed.",
          status: "success",
          duration: 5000,
          isClosable: true
        });
        onSuccessfulTx(); // Refresh allowances
        setPendingTxType(null); // Reset state, keep panel open

      } else if (pendingTxType === 'liquidity') {
        toast({
          title: "Transaction Confirmed",
          description: "Liquidity updated successfully.",
          status: "success",
          duration: 5000,
          isClosable: true
        });
        onSuccessfulTx(); // Refresh pool data
        setManageMode(null); // Close panel after liquidity action
        setPendingTxType(null); // Reset state
      }
      // If pendingTxType was somehow null, we might log an error or do nothing
      // else {
      //   console.warn("Transaction confirmed but pendingTxType was null.");
      // }

    } else if (writeError) { // Handle write errors
      const message = writeError instanceof BaseError ? writeError.shortMessage : writeError.message;
      toast({ title: "Transaction Error", description: message, status: "error", duration: 7000, isClosable: true });
      setPendingTxType(null); // Reset pending type on error

    } else if (confirmationError) { // Handle confirmation errors
      const message = confirmationError instanceof BaseError ? confirmationError.shortMessage : confirmationError.message;
      toast({ title: "Confirmation Error", description: message, status: "error", duration: 7000, isClosable: true });
      setPendingTxType(null); // Reset pending type on error
    }
  }, [isConfirmed, writeError, confirmationError, pendingTxType, toast, onSuccessfulTx, setManageMode]); // Added setManageMode to dependencies

  // Reset amounts only when manage mode explicitly changes to null (panel closes)
  useEffect(() => {
    if (manageMode === null) {
      setAmountToken1('');
      setAmountToken2('');
      setAmountLp('');
    }
  }, [manageMode]);

  // Check allowances
  const needsApprovalToken1 = useMemo(() => {
      // Check against sepoliaWethAddress - no approval needed for native ETH
      if (!poolToken1Address || poolToken1Address.toLowerCase() === sepoliaWethAddress.toLowerCase()) return false;
      try {
          const amount1Parsed = parseUnits(amountToken1 || '0', DECIMALS);
          return amount1Parsed > 0n && (!pool.token1Allowance || pool.token1Allowance < amount1Parsed);
      } catch { return false; }
  }, [amountToken1, pool.token1Allowance, poolToken1Address]);

  const needsApprovalToken2 = useMemo(() => {
      // Check against sepoliaWethAddress - no approval needed for native ETH
      if (!poolToken2Address || poolToken2Address.toLowerCase() === sepoliaWethAddress.toLowerCase()) return false;
      try {
          const amount2Parsed = parseUnits(amountToken2 || '0', DECIMALS);
          return amount2Parsed > 0n && (!pool.token2Allowance || pool.token2Allowance < amount2Parsed);
      } catch { return false; }
  }, [amountToken2, pool.token2Allowance, poolToken2Address]);

   const needsApprovalLp = useMemo(() => {
      try {
          // Always check if LP allowance exists
          const lpAmountParsed = parseUnits(amountLp || '0', DECIMALS);
          
          // Debug logs for LP approval checks
          if (pool.name.includes('SPARX/cbXEN')) {
            console.log('--- SPARX/cbXEN LP Approval Check ---');
            console.log('LP Address:', pool.address);
            console.log('LP Amount Parsed:', lpAmountParsed.toString());
            console.log('Current LP Allowance:', pool.lpTokenAllowance ? pool.lpTokenAllowance.toString() : 'null');
            console.log('Router Address:', uniswapRouterAddress);
          }
          
          // If no allowance data or it's less than requested amount, need approval
          if (!pool.lpTokenAllowance || lpAmountParsed > 0n && pool.lpTokenAllowance < lpAmountParsed) {
            return true;
          }
          return false;
        } catch (e) {
          console.error("Error checking LP approval:", e);
          return true; // Assume approval needed if there's an error
        }
  }, [amountLp, pool.lpTokenAllowance, pool.address, pool.name, uniswapRouterAddress]);

  // Get logo for the pool
  const poolLogo = useMemo(() => getTokenLogo(pool.token1, pool.token2), [pool.token1, pool.token2]);

  // --- Debug Log --- 
  useEffect(() => {
    console.log(`PoolCard Render [${pool.name}] - PID: ${pool.pid}, Loading: ${loading}`);
    console.log(`  Reserves Raw: ${pool.reserve0Raw}, ${pool.reserve1Raw}`);
    console.log(`  Reserves BigInt: ${reserve1BigInt}, ${reserve2BigInt}`);
    console.log(`  User LP Balance: ${pool.userLpBalance}`);
  }, [pool, loading, reserve1BigInt, reserve2BigInt]);

  // Format big integers with K, M, B suffixes for better readability
  const formatBigIntDisplay = (value: bigint | null | undefined, decimals = 18, displayDecimals = 4) => {
    if (value === null || typeof value === 'undefined') return '0.0'.padEnd(displayDecimals + 2, '0');
    const formatted = formatUnits(value, decimals);
    const num = parseFloat(formatted);
    
    // Special case for extremely large numbers (scientific notation) - likely max approvals
    if (num > 1_000_000_000 || formatted.includes('e+')) {
      return "1B+";
    }
    
    // Format with suffixes for large numbers
    if (num >= 1_000_000_000) {
      return `${(num / 1_000_000_000).toFixed(2)}B`;
    } else if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(2)}K`;
    }
    
    // Regular formatting for smaller numbers
    const [integerPart, fractionalPart = ''] = formatted.split('.');
    return `${integerPart}.${fractionalPart.slice(0, displayDecimals).padEnd(displayDecimals, '0')}`;
  };

  // --- Colors ---
  const primaryColor = '#FF6937';  // Define the primary color constant for approvals
  const buttonBgColor = '#92400e'; // Dark orange/brown color
  const buttonHoverColor = '#b45309'; // Lighter orange/brown
  const darkCardBg = '#252f3f'; // Card background
  const darkInputBg = '#1e293b'; // Input background

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
            onClick={handleRemoveClick}
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
                              onClick={() => {
                                // Use safe max amount
                                const balance = userToken1BalanceToDisplay ?? 0n;
                                if (balance > 0n) {
                                  const safeBalance = balance;
                                  handleAmount1Change(formatUnits(safeBalance, DECIMALS));
                                }
                              }}
                            >
                              MAX
                            </Button>
                        </InputRightAddon>
                    </InputGroup>
                    {/* Add approval display for Token 1 */}
                    {!needsApprovalToken1 && 
                      pool.token1Allowance != null && 
                      typeof pool.token1Allowance === 'bigint' && 
                      pool.token1Allowance > 0n && 
                      poolToken1Address?.toLowerCase() !== sepoliaWethAddress.toLowerCase() && (
                        <Flex justify="flex-end" mt={1}>
                          <Text fontSize="xs" color={primaryColor}>
                            {`Approved: ${formatBigIntDisplay(pool.token1Allowance)}`}
                          </Text>
                        </Flex>
                    )}
                    {needsApprovalToken1 && 
                      pool.token1Allowance != null && 
                      typeof pool.token1Allowance === 'bigint' && 
                      pool.token1Allowance > 0n && (
                        <Flex justify="flex-end" mt={1}>
                          <Text fontSize="xs" color="yellow.400">
                            {`Approved: ${formatBigIntDisplay(pool.token1Allowance)} (insufficient)`}
                          </Text>
                        </Flex>
                    )}
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
                              onClick={() => {
                                // Use safe max amount
                                const balance = userToken2BalanceToDisplay ?? 0n;
                                if (balance > 0n) {
                                  const safeBalance = balance;
                                  handleAmount2Change(formatUnits(safeBalance, DECIMALS));
                                }
                              }}
                            >
                              MAX
                            </Button>
                        </InputRightAddon>
                    </InputGroup>
                    {/* Add approval display for Token 2 */}
                    {!needsApprovalToken2 && 
                      pool.token2Allowance != null && 
                      typeof pool.token2Allowance === 'bigint' && 
                      pool.token2Allowance > 0n && 
                      poolToken2Address?.toLowerCase() !== sepoliaWethAddress.toLowerCase() && (
                        <Flex justify="flex-end" mt={1}>
                          <Text fontSize="xs" color={primaryColor}>
                            {`Approved: ${formatBigIntDisplay(pool.token2Allowance)}`}
                          </Text>
                        </Flex>
                    )}
                    {needsApprovalToken2 && 
                      pool.token2Allowance != null && 
                      typeof pool.token2Allowance === 'bigint' && 
                      pool.token2Allowance > 0n && (
                        <Flex justify="flex-end" mt={1}>
                          <Text fontSize="xs" color="yellow.400">
                            {`Approved: ${formatBigIntDisplay(pool.token2Allowance)} (insufficient)`}
                          </Text>
                        </Flex>
                    )}
                </FormControl>

                {/* Action Buttons (Approve/Add) */}
                <HStack>
                    {(needsApprovalToken1 || needsApprovalToken2) && (
                        <Button
                            colorScheme="yellow"
                            onClick={() => handleApprove(needsApprovalToken1 ? poolToken1Address : poolToken2Address)}
                            // isLoading only if tx is loading AND it's an approval tx
                            isLoading={isTxLoading && pendingTxType === 'approval'}
                            isDisabled={isTxLoading} // Disable if any tx is loading
                            flex={1}
                        >
                            Approve {needsApprovalToken1 ? pool.token1 : pool.token2}
                        </Button>
                    )}
                     {!needsApprovalToken1 && !needsApprovalToken2 && (
                        <Button
                            colorScheme="brand"
                            onClick={handleAddLiquidity}
                            // isLoading only if tx is loading AND it's a liquidity tx
                            isLoading={isTxLoading && pendingTxType === 'liquidity'}
                            // Also disable if approval is needed (safeguard) or inputs invalid
                            isDisabled={needsApprovalToken1 || needsApprovalToken2 || isTxLoading || uniswapRouterAddress === zeroAddress || !amountToken1 || !amountToken2 || parseFloat(amountToken1) <= 0 || parseFloat(amountToken2) <= 0}
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
                              onClick={() => {
                                // Use safe max amount
                                const balance = pool.userLpBalance ?? 0n;
                                if (balance > 0n) {
                                  const safeBalance = balance;
                                  setAmountLp(formatUnits(safeBalance, DECIMALS));
                                }
                              }}
                            >
                              MAX
                            </Button>
                        </InputRightAddon>
                    </InputGroup>
                    {/* Add approval display for LP tokens */}
                    {!needsApprovalLp && 
                      pool.lpTokenAllowance != null && 
                      typeof pool.lpTokenAllowance === 'bigint' && 
                      pool.lpTokenAllowance > 0n && (
                        <Flex justify="flex-end" mt={1}>
                          <Text fontSize="xs" color={primaryColor}>
                            Approved: {formatBigIntDisplay(pool.lpTokenAllowance)}
                          </Text>
                        </Flex>
                    )}
                    {needsApprovalLp && 
                      pool.lpTokenAllowance != null && 
                      typeof pool.lpTokenAllowance === 'bigint' && 
                      pool.lpTokenAllowance > 0n && (
                        <Flex justify="flex-end" mt={1}>
                          <Text fontSize="xs" color="yellow.400">
                            Approved: {formatBigIntDisplay(pool.lpTokenAllowance)} (insufficient)
                          </Text>
                        </Flex>
                    )}
                </FormControl>

                {/* Action Buttons (Approve/Remove) */}
                <HStack>
                    {needsApprovalLp && (
                        <Button
                          colorScheme="yellow"
                          onClick={() => handleApprove(pool.address)}
                          // isLoading only if tx is loading AND it's an approval tx
                          isLoading={isTxLoading && pendingTxType === 'approval'}
                          isDisabled={isTxLoading} // Disable if any tx is loading
                          flex={1}
                        >
                          Approve LP Tokens
                        </Button>
                    )}
                    {!needsApprovalLp && (
                      <Button
                          colorScheme="red"
                          onClick={handleRemoveLiquidity}
                          // isLoading only if tx is loading AND it's a liquidity tx
                          isLoading={isTxLoading && pendingTxType === 'liquidity'}
                          // Also disable if approval is needed (safeguard) or input invalid
                          isDisabled={needsApprovalLp || isTxLoading || uniswapRouterAddress === zeroAddress || !amountLp || parseFloat(amountLp) <= 0}
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