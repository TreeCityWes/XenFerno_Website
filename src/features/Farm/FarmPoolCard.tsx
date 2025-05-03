import {
  Box,
  Heading,
  Text,
  Button,
  VStack,
  HStack,
  Divider,
  useToast,
  Input,
  InputGroup,
  InputRightAddon,
  Spinner,
  Flex,
  useColorModeValue,
  FormControl, FormHelperText,
  Skeleton,
  Grid,
  GridItem,
  Spacer,
  CircularProgress,
  CircularProgressLabel,
  Tooltip,
  Badge,
  Progress,
  Image,
  SimpleGrid,
} from '@chakra-ui/react';
import { useState, useEffect, useMemo } from 'react';
import { FarmPoolCardData } from './FarmTab';
import { type Abi, formatUnits, parseUnits, maxUint256, BaseError, zeroAddress, Address } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import erc20Abi from '../../abis/ERC20.json' with { type: 'json' };
import { useCountdown } from '../../hooks/useCountdown'; // Import from new hook file

// Import token logos
// import sparxLogo from '../../assets/sparx-circle-logo.png';
// import cbxenLogo from '../../assets/cbxen-circle-logo.png';
// import xburnLogo from '../../assets/xenburn.png';

const erc20AbiDirect = erc20Abi as Abi; // Use imported JSON directly as ABI array

// Define theme colors - updated for fire theme
const primaryColor = '#FF6937';          // Fiery orange-red (XBURN primary)
const sparxColor = '#FFA500';            // Yellow-orange (SPARX primary)
const accentColor = '#FF6937';           // Use primaryColor as main accent
const secondaryAccentColor = '#FFA500';   // Use sparxColor as secondary accent
const darkBg = '#1A202C';               // Darker background (adjust if needed)
const darkCardBg = '#2D3748';           // Slightly lighter card background (adjust if needed)
const darkInputBg = '#1A202C';          // Dark input background
const borderColor = '#4A5568';          // Slightly lighter border color for contrast
const burnRed = '#E53E3E';               // Adjusted red for better visibility
const burnOrange = '#DD6B20';            // Adjusted orange for better visibility
const lightTextColor = 'gray.200';       // Main text color on dark BG
const subtleTextColor = 'gray.400';      // Helper text color
const countdownColor = 'teal.300';       // Color for countdown timers

// Define the target color from PoolCard heading
const targetColor = 'brand.400'; // #FFCA28 - The yellow color from Liquidity tab heading

interface FarmPoolCardProps {
  data: FarmPoolCardData;
  farmAddress: `0x${string}`;
  farmAbi: Abi;
  onSuccessfulTx: () => void;
  totalAllocPoint: bigint;
  currentRate: bigint;
  distributionShare: bigint | null;
}

// Helper component for key-value display
const DataRow: React.FC<{ label: string; children: React.ReactNode; isLoading?: boolean; labelColor?: string; valueColor?: string, labelSize?: string; valueSize?: string; valueWeight?: string }> = ({ 
    label, children, isLoading = false, labelColor = subtleTextColor, valueColor, labelSize = "sm", valueSize="md", valueWeight="medium" 
}) => (
    <Flex justify="space-between" align="center" w="full">
        <Text fontSize={labelSize} color={labelColor}>{label}</Text>
        <Skeleton isLoaded={!isLoading} minHeight="20px">
             <Text fontSize={valueSize} fontWeight={valueWeight} color={valueColor} textAlign="right">{children}</Text>
        </Skeleton>
    </Flex>
);

// Add this helper function after formatBigIntRaw to format duration in a friendly way
const formatDuration = (seconds: bigint | null | undefined): string => {
  if (!seconds) return "0";
  const totalSeconds = Number(seconds);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

// Remove the complex lock status indicator component and replace with simpler implementation
const LockStatusIndicator: React.FC<{
  lockInfo: { secondsRemaining: bigint; bonusMultiplier: bigint } | null;
  isLoading: boolean;
}> = ({ lockInfo, isLoading }) => {
  // Show nothing if no lock info exists or it's loading
  if (!lockInfo || lockInfo.secondsRemaining === 0n) {
    return null;
  }
  
  // Get remaining days
  const remainingDays = Math.ceil(Number(lockInfo.secondsRemaining) / 86400);
  
  return (
    <Badge colorScheme="red" variant="solid" px={2} py={1} width="fit-content">
      LOCKED: {remainingDays}D REMAINING
    </Badge>
  );
};

// Replace the CooldownIndicator with a simpler version
const CooldownIndicator: React.FC<{
  cooldownInfo: any;
  label: string;
}> = ({ cooldownInfo, label }) => {
  if (!cooldownInfo) return null;
  
  // Determine if this is a stake or withdraw cooldown
  const isActive = label === 'Stake' 
    ? cooldownInfo.isCooldownActive 
    : cooldownInfo.isWithdrawCooldownActive;
    
  const endTimestamp = label === 'Stake'
    ? cooldownInfo.cooldownEnds
    : cooldownInfo.withdrawCooldownEnds;
    
  // If not active, don't show anything
  if (!isActive) return null;
  
  // Calculate remaining time
  const now = BigInt(Math.floor(Date.now() / 1000));
  const remaining = endTimestamp - now;
  
  return (
    <Text 
      fontSize="xs" 
      bgGradient="linear(to-r, red.500, orange.500)"
      bgClip="text"
      fontWeight="bold"
    >
      {label} available in {formatDuration(remaining)}
    </Text>
  );
};

// Helper function to get token logo URL
const getTokenLogo = (token1: string, token2: string): string => {
  // cbXEN pair - use cbXEN logo (case insensitive)
  if (token1.toUpperCase() === 'CBXEN' || token2.toUpperCase() === 'CBXEN') {
    return '/cbxen-circle-logo.png';
  }
  
  // SPARX pairs - use SPARX logo (only if not paired with cbXEN)
  if ((token1 === 'SPARX' && token2.toUpperCase() !== 'CBXEN') || 
      (token2 === 'SPARX' && token1.toUpperCase() !== 'CBXEN')) {
    return '/sparx-circle-logo.png';
  }

  // XBURN pair - use XBURN logo
  if (token1 === 'XBURN' || (token1 === 'XBURN' && token2 === 'WETH') || (token2 === 'XBURN' && token1 === 'WETH')) {
    return '/logo192.png';
  }

  // Default to SPARX logo if no match
  return '/sparx-circle-logo.png';
};

// Main Component
export const FarmPoolCard: React.FC<FarmPoolCardProps> = ({ 
  data, 
  farmAddress, 
  farmAbi, 
  onSuccessfulTx,
  totalAllocPoint,
  currentRate,
  distributionShare
}) => {
  const { 
    poolInfo, 
    walletBalance, 
    allowance, 
    pendingRewards, 
    stakedBalance, 
    lpTotalSupply, 
    lpReserves,
    cooldownInfo
  } = data;
  const { address: userAddress } = useAccount();
  const toast = useToast();
  const cardBg = useColorModeValue(darkCardBg, darkCardBg);
  const inputBg = useColorModeValue(darkInputBg, darkInputBg);
  const bgHighlight = useColorModeValue('gray.700', 'gray.700');
  const fireColor = useColorModeValue(primaryColor, primaryColor);
  // Enhanced fire text effect for headings
  const fireHeadingText = { 
    color: sparxColor, // Use sparxColor (orange) for the heading
  };
  // Subtle glow for important numbers
  const sparxNumberText = { 
    color: targetColor, // Keep rewards yellow (brand.400) for now
  };

  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [activeTab, setActiveTab] = useState<'stake' | 'unstake'>('stake');
  const [selectedLockTime, setSelectedLockTime] = useState<number>(0); // 0 = no lock, 3 = 3 days, 7 = 7 days, 30 = 30 days

  const { 
    data: hash, 
    error: writeError, 
    isPending, 
    writeContract 
  } = useWriteContract();

  const { 
    isLoading: isConfirming, 
    isSuccess: isConfirmed, 
    error: confirmationError 
  } = useWaitForTransactionReceipt({ hash });

  const isTxLoading = isPending || isConfirming;

  const stakingTokenAddress = poolInfo.lpAddress;
  const isSingleSided = !poolInfo.token2Symbol; // Simplified check
  const stakingTokenSymbol = isSingleSided ? poolInfo.token1Symbol : 'LP';

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
  
  const formatBigIntRaw = (value: bigint | null | undefined, decimals = 18) => {
    if (value === null || typeof value === 'undefined') return '0';
    return formatUnits(value, decimals);
  }

  const stakedBalanceFormatted = useMemo(() => formatBigIntDisplay(stakedBalance), [stakedBalance]);
  const walletBalanceFormatted = useMemo(() => formatBigIntDisplay(walletBalance), [walletBalance]);
  const pendingRewardsFormatted = useMemo(() => formatBigIntDisplay(pendingRewards), [pendingRewards]);

  const { stakedToken0AmountFormatted, stakedToken1AmountFormatted } = useMemo(() => {
    if (isSingleSided || !stakedBalance || stakedBalance === 0n || !lpTotalSupply || lpTotalSupply === 0n || !lpReserves) {
        return { stakedToken0AmountFormatted: null, stakedToken1AmountFormatted: null };
    }
    const share = Number(stakedBalance) / Number(lpTotalSupply);
    // TODO: Fetch actual decimals if needed, assuming 18
    const token0Decimals = 18; 
    const token1Decimals = 18; 
    const stakedToken0Amount = BigInt(Math.floor(share * Number(lpReserves.reserve0)));
    const stakedToken1Amount = BigInt(Math.floor(share * Number(lpReserves.reserve1)));
    return {
        stakedToken0AmountFormatted: formatBigIntDisplay(stakedToken0Amount, token0Decimals),
        stakedToken1AmountFormatted: formatBigIntDisplay(stakedToken1Amount, token1Decimals),
    };
  }, [stakedBalance, lpTotalSupply, lpReserves, isSingleSided]);

  // Determine if approval is needed based on allowance and potential stake amount
  const requiresApproval = useMemo(() => {
    const currentAllowance = typeof allowance === 'bigint' ? allowance : 0n;
    // If allowance is 0, approval is always required before staking can happen
    if (currentAllowance === 0n) return true;
    
    // If allowance is non-zero, check if the typed amount exceeds it
    try {
      if (!stakeAmount) return false; // Don't require re-approval if input is empty and allowance > 0
      const stakeAmountParsed = parseUnits(stakeAmount, 18); 
      return currentAllowance < stakeAmountParsed;
    } catch { return false; }
  }, [allowance, stakeAmount]);

  // Check if the button should show "Approve" or "Stake"
  const showApproveButton = useMemo(() => {
    const currentAllowance = typeof allowance === 'bigint' ? allowance : 0n;
    // Show approve if allowance is zero OR if the typed amount exceeds non-zero allowance
    return currentAllowance === 0n || requiresApproval;
  }, [allowance, requiresApproval]);

  const hasWalletBalance = walletBalance !== null && walletBalance > 0n;
  const hasStakedBalance = stakedBalance !== null && stakedBalance > 0n;
  const hasPendingRewards = pendingRewards !== null && pendingRewards > 0n;
  const stakeAmountNum = parseFloat(stakeAmount) || 0;
  const unstakeAmountNum = parseFloat(unstakeAmount) || 0;

  // --- Reward Share Formatting ---
  const rewardShareFormatted = useMemo(() => {
      if (distributionShare === null || typeof distributionShare === 'undefined') return 'N/A';
      // Value is in Basis Points (e.g., 3250 = 32.5%), divide by 100
      return `${Number(distributionShare) / 100}%`;
  }, [distributionShare]);

  // Get logo for the pool
  const poolLogo = useMemo(() => 
    getTokenLogo(poolInfo.token1Symbol, poolInfo.token2Symbol), 
    [poolInfo.token1Symbol, poolInfo.token2Symbol]
  );

  // --- Event Handlers (Simplified) ---
  const handleApprove = () => {
    try {
      // Exact amount the user entered - no buffer
      const amountToApprove = parseUnits(stakeAmount || '0', 18);

      // Only proceed if amount is greater than zero
      if (amountToApprove <= 0n) {
        toast({ title: "Invalid Amount", description: "Please enter an amount greater than zero", status: "warning" });
        return;
      }
      
      console.log('--- Approving Token ---');
      console.log('Token Address:', stakingTokenAddress);
      console.log('Farm Address (spender):', farmAddress);
      console.log('Amount to Approve:', formatUnits(amountToApprove, 18));
      
      writeContract({ 
        address: stakingTokenAddress, 
        abi: erc20AbiDirect, 
        functionName: 'approve', 
        args: [farmAddress, amountToApprove]
      });
    } catch (error) {
      console.error("Error calculating approval amount:", error);
      toast({ title: "Error", description: "Failed to calculate approval amount", status: "error", duration: 5000 });
    }
  };
  const handleStake = () => {
      if (!stakeAmount || stakeAmountNum <= 0) return;
      if (cooldownInfo?.isCooldownActive) {
          toast({ title: "Cooldown Active", description: `Please wait before staking again.`, status: "warning", duration: 5000, isClosable: true });
          return;
      }
      // Explicit re-check of allowance vs amount just before sending TX
      const currentAllowance = typeof allowance === 'bigint' ? allowance : 0n;
      try {
        const amountParsed = parseUnits(stakeAmount, 18);
        if (currentAllowance < amountParsed) {
            toast({ title: "Approval Required", description: "Allowance is less than the amount you're trying to stake. Please approve first.", status: "warning", duration: 6000, isClosable: true });
            return; // Prevent sending stake TX
        }
        if (walletBalance !== null && amountParsed > walletBalance) { toast({ title: "Insufficient balance", status: "warning" }); return; }
        // Show harvest warning only if everything else is okay
        if (hasPendingRewards) toast({ title: "Harvest Recommended", description: "Harvest pending rewards before staking more.", status: "info", duration: 6000, isClosable: true });

        // Convert selected lock time to option index
        const optionIndex = selectedLockTime === 0 ? 0 : 
                         selectedLockTime === 3 ? 1 : 
                         selectedLockTime === 7 ? 2 : 
                         selectedLockTime === 30 ? 3 : 0;
        
        console.log(`Staking with lock option: ${selectedLockTime} days (index: ${optionIndex})`);
        
        // Use updated deposit function with option index parameter
        writeContract({ 
          address: farmAddress, 
          abi: farmAbi, 
          functionName: 'deposit', 
          args: [BigInt(poolInfo.pid), amountParsed, optionIndex] 
        });
      } catch (e) { 
        console.error("Stake error:", e);
        toast({ title: "Invalid stake amount", description: String(e), status: "error" }); 
      }
  };
  const handleUnstake = () => {
      if (!unstakeAmount || unstakeAmountNum <= 0) return;
      if (cooldownInfo?.isWithdrawCooldownActive) {
          toast({ title: "Cooldown Active", description: `Please wait before withdrawing again.`, status: "warning", duration: 5000, isClosable: true });
          return;
      }
      try {
        const amountParsed = parseUnits(unstakeAmount, 18);
        if (stakedBalance !== null && amountParsed > stakedBalance) { toast({ title: "Insufficient staked balance", status: "warning" }); return; }
        writeContract({ address: farmAddress, abi: farmAbi, functionName: 'withdraw', args: [BigInt(poolInfo.pid), amountParsed] });
      } catch { toast({ title: "Invalid unstake amount", status: "error" }); }
  };
  const handleHarvest = () => writeContract({ address: farmAddress, abi: farmAbi, functionName: 'harvest', args: [BigInt(poolInfo.pid)] });

  // --- Transaction Result Handling ---
  useEffect(() => {
    if (isConfirmed) {
      // Check if this was an approval transaction
      const isApprovalTx = hash && hash.toString().includes('approve');
      
      toast({
        title: 'Transaction Successful',
        description: isApprovalTx ? "Token approval successful. You can now proceed with staking." : "Farm operation completed.",
        status: 'success',
        duration: 5000
      });
      
      // Always refresh data
      onSuccessfulTx();
      
      // Only clear inputs if it was NOT an approval transaction
      if (!isApprovalTx) {
        setStakeAmount(''); 
        setUnstakeAmount('');
      }
    }
    const txError = writeError || confirmationError;
    if (txError) {
      const message = txError instanceof BaseError ? txError.shortMessage : txError?.message || 'Unknown error';
      toast({ title: 'Transaction Failed', description: message, status: 'error', duration: 7000 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed, writeError, confirmationError, hash]);

  // --- Rendering ---
  return (
    <Box 
      borderWidth="1px" 
      borderRadius="xl" 
      p={5} 
      boxShadow="lg" 
      bg={darkCardBg} 
      borderColor={borderColor} 
      overflow="hidden"
      transition='all 0.3s ease'
      _hover={{
         borderColor: fireColor, 
         boxShadow: `0 0 15px ${primaryColor}44, 0 0 25px ${sparxColor}22` 
      }}
    >
      {/* Header with Logo and Pool Name */}
      <Flex align="center" justify="space-between" mb={4}>
        <Flex align="center">
          <Image 
            src={poolLogo} 
            alt={`${poolInfo.name} logo`} 
            boxSize="32px" 
            borderRadius="full"
            mr={2}
          />
          <Box>
            <Heading size="md" color={sparxColor}>{poolInfo.name}</Heading>
            <Text fontSize="xs" color={subtleTextColor}>PID: {poolInfo.pid}</Text>
          </Box>
        </Flex>
        
        {/* Reward Share Badge */}
        <Badge colorScheme="yellow" variant="solid" fontSize="sm">
          {rewardShareFormatted} BOOST
        </Badge>
      </Flex>
      
      {/* Main Info Cards - 2 columns layout */}
      <SimpleGrid columns={2} spacing={4} mb={4}>
        {/* Left Card - Balance */}
        <Box bg="gray.800" p={3} borderRadius="md">
          <Text fontSize="sm" color={subtleTextColor} mb={1}>Staked Balance</Text>
          <Skeleton isLoaded={stakedBalance !== null && stakedBalance !== undefined}>
            <Text fontSize="xl" fontWeight="bold" color={lightTextColor}>
              {stakedBalanceFormatted} {stakingTokenSymbol}
            </Text>
            
            {/* Show token composition for LP tokens - each on its own line */}
            {!isSingleSided && stakedToken0AmountFormatted && stakedToken1AmountFormatted && (
              <VStack spacing={0} align="flex-start" mt={1}>
                <Text fontSize="xs" color={subtleTextColor}>
                  ~{stakedToken0AmountFormatted} {poolInfo.token1Symbol}
                </Text>
                <Text fontSize="xs" color={subtleTextColor}>
                  ~{stakedToken1AmountFormatted} {poolInfo.token2Symbol}
                </Text>
              </VStack>
            )}
          </Skeleton>
          
          {/* Clear Lock Status display */}
          {hasStakedBalance && (
            <Flex mt={2} align="center">
              {data.lockInfo && data.lockInfo.secondsRemaining > 0n ? (
                <Badge colorScheme="red" variant="solid" px={2} py={1} width="fit-content" fontSize="xs">
                  LOCKED: {Math.ceil(Number(data.lockInfo.secondsRemaining) / 86400)}D REMAINING
                </Badge>
              ) : (
                <Badge colorScheme="green" variant="solid" px={2} py={1} width="fit-content" fontSize="xs">
                  NOT LOCKED
                </Badge>
              )}
            </Flex>
          )}
        </Box>
        
        {/* Right Card - Rewards */}
        <Box bg="gray.800" p={3} borderRadius="md">
          <Text fontSize="sm" color={subtleTextColor} mb={1}>Pending Rewards</Text>
          <Skeleton isLoaded={pendingRewards !== null && pendingRewards !== undefined}>
            <VStack spacing={0} align="flex-start">
              <Text fontSize="xl" fontWeight="bold" color="yellow.400">
                {pendingRewardsFormatted} SPARX
              </Text>
              <Text fontSize="xs" color={subtleTextColor}>
                ~${(parseFloat(pendingRewardsFormatted) * 0.015).toFixed(2)} USD
              </Text>
            </VStack>
            
            {/* Add spacer to push button to bottom */}
            <Box height="8px" />
            
            {/* Harvest button at bottom with cooldown check */}
            <Tooltip 
              isDisabled={!cooldownInfo?.isCooldownActive} 
              hasArrow 
              label={`Harvest available in ${formatDuration(cooldownInfo?.cooldownEnds ? cooldownInfo.cooldownEnds - BigInt(Math.floor(Date.now() / 1000)) : 0n)}`}
              placement="top"
            >
              <Box width="100%">
                <Button
                  mt={2}
                  size="sm"
                  width="full"
                  bg={sparxColor}
                  color="black"
                  _hover={{ bg: 'yellow.500' }}
                  onClick={handleHarvest}
                  isDisabled={!userAddress || !hasPendingRewards || isTxLoading || cooldownInfo?.isCooldownActive}
                  isLoading={isTxLoading && hash && !isConfirmed}
                >
                  Harvest
                </Button>
                
                {/* Show cooldown message if active */}
                {cooldownInfo?.isCooldownActive && hasPendingRewards && (
                  <Text 
                    fontSize="xs" 
                    fontWeight="bold"
                    bgGradient="linear(to-r, red.500, orange.500)"
                    bgClip="text"
                    textAlign="center"
                    mt={1}
                  >
                    Harvest in {formatDuration(cooldownInfo.cooldownEnds - BigInt(Math.floor(Date.now() / 1000)))}
                  </Text>
                )}
              </Box>
            </Tooltip>
          </Skeleton>
        </Box>
      </SimpleGrid>
      
      {/* Stake/Unstake Tabs */}
      <Box>
        <Flex mb={2} background="gray.900" borderRadius="md" p={1}>
          <Button 
            flex="1" 
            size="sm"
            variant={activeTab === 'stake' ? 'solid' : 'ghost'} 
            bg={activeTab === 'stake' ? 'gray.700' : 'transparent'}
            color={activeTab === 'stake' ? fireColor : subtleTextColor}
            borderRadius="md"
            _hover={{ bg: 'gray.700' }}
            onClick={() => setActiveTab('stake')}
            fontWeight={activeTab === 'stake' ? 'bold' : 'normal'}
          >
            Stake
          </Button>
          <Button 
            flex="1" 
            size="sm"
            variant={activeTab === 'unstake' ? 'solid' : 'ghost'} 
            bg={activeTab === 'unstake' ? 'gray.700' : 'transparent'}
            color={activeTab === 'unstake' ? fireColor : subtleTextColor}
            borderRadius="md"
            _hover={{ bg: 'gray.700' }}
            onClick={() => setActiveTab('unstake')}
            fontWeight={activeTab === 'unstake' ? 'bold' : 'normal'}
          >
            Unstake
          </Button>
        </Flex>
        
        {/* Tab Content */}
        <Box bg="gray.800" p={4} borderRadius="md">
          {activeTab === 'stake' ? (
            <VStack spacing={3} align="stretch">
              {/* Stake Amount Input */}
              <FormControl>
                <Flex justify="space-between" mb={1}>
                  <FormHelperText color={subtleTextColor}>Amount to stake</FormHelperText>
                  <FormHelperText color={lightTextColor}>Wallet: {walletBalanceFormatted}</FormHelperText>
                </Flex>
                <InputGroup size="md">
                  <Input
                    bg="gray.900"
                    borderColor="gray.700"
                    color={lightTextColor}
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    placeholder="0.0"
                    type="number"
                    isDisabled={isTxLoading || !hasWalletBalance}
                  />
                  <InputRightAddon bg="gray.900" p={0}>
                    <Button 
                      h="full"
                      size="sm" 
                      bg="transparent"
                      color={fireColor}
                      onClick={() => walletBalance && setStakeAmount(formatBigIntRaw(walletBalance))}
                      isDisabled={isTxLoading || !hasWalletBalance}
                    >
                      MAX
                    </Button>
                  </InputRightAddon>
                </InputGroup>
                
                {/* Display Approval Status */}
                {allowance !== null && typeof allowance === 'bigint' && allowance > 0n && (
                  <Flex justify="flex-end" mt={1}>
                    <Text 
                      fontSize="xs" 
                      color={requiresApproval ? "yellow.400" : primaryColor}
                    >
                      {`Approved: ${formatBigIntDisplay(allowance)}${requiresApproval && stakeAmount ? " (insufficient)" : ""}`}
                    </Text>
                  </Flex>
                )}
              </FormControl>
              
              {/* Lock Duration Selection - back to 2x2 grid but cleaner */}
              <Box>
                <Text fontSize="sm" color={subtleTextColor} mb={2}>Lock Duration (optional)</Text>
                <SimpleGrid columns={2} spacing={2}>
                  <Button 
                    size="sm" 
                    height="36px"
                    variant={selectedLockTime === 0 ? "solid" : "outline"}
                    colorScheme={selectedLockTime === 0 ? "yellow" : "gray"}
                    onClick={() => setSelectedLockTime(0)}
                    fontWeight="medium"
                  >
                    No Lock
                  </Button>
                  <Button 
                    size="sm" 
                    height="36px"
                    variant={selectedLockTime === 3 ? "solid" : "outline"}
                    colorScheme={selectedLockTime === 3 ? "orange" : "gray"}
                    onClick={() => setSelectedLockTime(3)}
                    fontWeight="medium"
                  >
                    3d (+10%)
                  </Button>
                  <Button 
                    size="sm" 
                    height="36px"
                    variant={selectedLockTime === 7 ? "solid" : "outline"}
                    colorScheme={selectedLockTime === 7 ? "red" : "gray"}
                    bg={selectedLockTime === 7 ? "red.500" : "transparent"}
                    _hover={{ bg: selectedLockTime === 7 ? "red.600" : "gray.600" }}
                    onClick={() => setSelectedLockTime(7)}
                    fontWeight="medium"
                  >
                    7d (+20%)
                  </Button>
                  <Button 
                    size="sm"
                    height="36px" 
                    variant={selectedLockTime === 30 ? "solid" : "outline"}
                    colorScheme={selectedLockTime === 30 ? "red" : "gray"}
                    bg={selectedLockTime === 30 ? "darkred" : "transparent"}
                    color={selectedLockTime === 30 ? "white" : "gray.400"}
                    _hover={{ bg: selectedLockTime === 30 ? "#a00" : "gray.600" }}
                    onClick={() => setSelectedLockTime(30)}
                    fontWeight="medium"
                  >
                    30d (+50%)
                  </Button>
                </SimpleGrid>
              </Box>
              
              {/* Action Button - centered with auto width */}
              <Flex justify="center" mt={2}>
                {showApproveButton ? (
                  <Button 
                    width="70%" 
                    bg={sparxColor} 
                    color="black" 
                    _hover={{ bg: 'yellow.500' }}
                    onClick={handleApprove}
                    isLoading={isTxLoading && hash !== null}
                    isDisabled={!userAddress || isTxLoading || !hasWalletBalance}
                  >
                    Approve {stakingTokenSymbol}
                  </Button>
                ) : (
                  <Button 
                    width="70%" 
                    bg={burnOrange} 
                    color="white" 
                    _hover={{ bg: 'orange.600' }}
                    onClick={handleStake}
                    isLoading={isTxLoading}
                    isDisabled={!userAddress || isTxLoading || !hasWalletBalance || stakeAmountNum <= 0}
                  >
                    Stake {stakingTokenSymbol}
                  </Button>
                )}
              </Flex>
              
              {/* Stake Available Timer */}
              {cooldownInfo?.isCooldownActive && (
                <Box 
                  mt={2} 
                  py={1} 
                  px={3} 
                  borderRadius="md" 
                  bg="rgba(255,100,50,0.1)" 
                  textAlign="center"
                >
                  <Text 
                    fontSize="xs" 
                    fontWeight="bold"
                    bgGradient="linear(to-r, red.500, orange.500)"
                    bgClip="text"
                  >
                    Stake available in {formatDuration(cooldownInfo.cooldownEnds - BigInt(Math.floor(Date.now() / 1000)))}
                  </Text>
                </Box>
              )}
            </VStack>
          ) : (
            <VStack spacing={3} align="stretch">
              {/* Unstake Amount Input */}
              <FormControl>
                <Flex justify="space-between" mb={1}>
                  <FormHelperText color={subtleTextColor}>Amount to unstake</FormHelperText>
                  <FormHelperText color={lightTextColor}>Staked: {stakedBalanceFormatted}</FormHelperText>
                </Flex>
                <InputGroup size="md">
                  <Input
                    bg="gray.900"
                    borderColor="gray.700"
                    color={lightTextColor}
                    value={unstakeAmount}
                    onChange={(e) => setUnstakeAmount(e.target.value)}
                    placeholder="0.0"
                    type="number"
                    isDisabled={isTxLoading || !hasStakedBalance}
                  />
                  <InputRightAddon bg="gray.900" p={0}>
                    <Button 
                      h="full"
                      size="sm" 
                      bg="transparent"
                      color={fireColor}
                      onClick={() => stakedBalance && setUnstakeAmount(formatBigIntRaw(stakedBalance))}
                      isDisabled={isTxLoading || !hasStakedBalance}
                    >
                      MAX
                    </Button>
                  </InputRightAddon>
                </InputGroup>
              </FormControl>
              
              {/* Unstake Button - centered with auto width */}
              <Flex justify="center" mt={2}>
                <Button 
                  width="70%"
                  bg={burnRed}
                  color="white" 
                  _hover={{ bg: 'red.600' }}
                  onClick={handleUnstake}
                  isDisabled={!userAddress || !unstakeAmount || unstakeAmountNum <= 0 || !hasStakedBalance || isTxLoading}
                  isLoading={isTxLoading && hash && !isConfirmed && unstakeAmountNum > 0}
                >
                  Unstake {stakingTokenSymbol}
                </Button>
              </Flex>
              
              {/* Cooldown Status - styled with gradient */}
              {cooldownInfo && cooldownInfo.isWithdrawCooldownActive && (
                <Box 
                  mt={2} 
                  py={1} 
                  px={3} 
                  borderRadius="md" 
                  bg="rgba(255,100,50,0.1)" 
                  textAlign="center"
                >
                  <Text 
                    fontSize="xs" 
                    fontWeight="bold"
                    bgGradient="linear(to-r, red.500, orange.500)"
                    bgClip="text"
                  >
                    Withdraw available in {formatDuration(cooldownInfo.withdrawCooldownEnds - BigInt(Math.floor(Date.now() / 1000)))}
                  </Text>
                </Box>
              )}
            </VStack>
          )}
        </Box>
      </Box>
    </Box>
  );
}; 