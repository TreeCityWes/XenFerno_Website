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
  Skeleton,
  Flex,
  useColorModeValue,
  FormControl, FormHelperText,
  Grid,
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
import { FarmPoolCardData } from '../Farm/FarmTab';
import { type Abi, formatUnits, parseUnits, maxUint256, BaseError } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import erc20Abi from '../../abis/ERC20.json' with { type: 'json' };
import { useCountdown } from '../../hooks/useCountdown';

// Import token logos
// import sparxLogo from '../../assets/sparx-circle-logo.png';
// import xburnLogo from '../../assets/xenburn.png';

const erc20AbiDirect = erc20Abi as Abi;

// --- Dark Fire Theme Colors (Matching Screenshot) ---
const primaryColor = '#FF6937';          // Accent orange (tabs, MAX button, cooldown text)
const sparxColor = '#FF9500';            // Orange for SPARX/XBURN titles
const darkCardBg = '#252f3f';           // Card background
const darkInputBg = '#1e293b';          // Input/Tab area background
const borderColor = '#374151';          // Borders
const buttonBrown = '#92400e';          // Brown for Harvest/Stake/Approve buttons
const buttonBrownHover = '#b45309';     // Hover for brown buttons
const buttonRed = '#b91c1c';             // Red for Unstake button
const buttonRedHover = '#991b1b';        // Hover for red buttons
const lockSelectedYellow = '#eab308';    // Yellow for selected "No Lock" button
const lockBorderColor = '#4b5563';      // Border for non-selected lock buttons
const boostYellow = '#eab308';          // Gold for boost badge
const lightTextColor = '#e5e7eb';       // Main text color (balances, etc.)
const subtleTextColor = '#9ca3af';      // Dimmer text color (labels)
const cooldownTextColor = '#38bdf8';     // Light blue for cooldown timers below buttons
const statusLockedBg = '#1e293b';      // Background for "Locked" badge
const statusNotLockedBg = '#065f46';    // Background for "Not Locked" badge (Green)
const statusStakeCdBg = '#92400e';       // Background for Stake Cooldown badge (Brown)
const statusWithdrawCdBg = '#9f1239';    // Background for Withdraw Cooldown badge (Dark Red)
const darkBg = '#1A202C';               // Darkest background (Input field)

// --- Aliases (if needed, direct usage preferred) ---
// const countdownColor = cooldownTextColor;
// const burnRed = buttonRed;

// Define the target color from PoolCard heading
const targetColor = '#FF9500'; // Updated to match sparxColor

// Define LockOption interface to match the contract
interface LockOption {
  duration: bigint;
  bonusMultiplier: bigint;
}

// Helper component for key-value display
const DataRow: React.FC<{ label: string; children: React.ReactNode; isLoading?: boolean; labelColor?: string; valueColor?: string, labelSize?: string; valueSize?: string; valueWeight?: string }> = ({ 
    label, children, isLoading = false, labelColor = subtleTextColor, valueColor, labelSize = "sm", valueSize="md", valueWeight="medium" 
}) => (
    <Flex justify="space-between" align="center" w="full">
        <Text fontSize={labelSize} color={labelColor}>{label}</Text>
        <Skeleton isLoaded={!isLoading}>
             <Text fontSize={valueSize} fontWeight={valueWeight} color={valueColor || lightTextColor} textAlign="right">{children}</Text>
        </Skeleton>
    </Flex>
);

// Format duration in a friendly way
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

// Format duration in days for display
const formatDurationInDays = (seconds: bigint): string => {
  if (!seconds) return "0d";
  const totalSeconds = Number(seconds);
  const days = Math.ceil(totalSeconds / 86400); // Round up to nearest day
  return `${days}d`;
};

// Format bonus multiplier for display
const formatBonus = (multiplier: bigint): string => {
  // Bonus is stored in basis points (10000 = 1x)
  const bonusPercent = (Number(multiplier) - 10000) / 100;
  if (bonusPercent <= 0) return "No Bonus";
  return `+${bonusPercent}%`;
};

// Lock status indicator component
const LockStatusIndicator: React.FC<{
  lockInfo: { secondsRemaining: bigint; bonusMultiplier: bigint } | null;
  isLoading: boolean;
}> = ({ lockInfo, isLoading }) => {
  // If no lock info or seconds remaining is 0, show unlocked state
  if (!lockInfo || lockInfo.secondsRemaining === 0n) {
    return (
      <Badge colorScheme="green" px={3} py={1} borderRadius="full">
        Unlocked
      </Badge>
    );
  }
  
  // Calculate % of lock time remaining (assuming max lock is 30 days = 2592000 seconds)
  const maxLockSeconds = 2592000; // 30 days in seconds
  const remainingSeconds = Number(lockInfo.secondsRemaining);
  const percentRemaining = Math.min(100, (remainingSeconds / maxLockSeconds) * 100);
  
  // Format the bonus multiplier for display
  const bonusMultiplier = Number(lockInfo.bonusMultiplier) / 100; // Assuming it's stored as basis points
  
  return (
    <Tooltip label={`Lock time remaining: ${formatDuration(lockInfo.secondsRemaining)}`}>
      <HStack spacing={2}>
        <CircularProgress 
          value={percentRemaining} 
          color={remainingSeconds > 86400 ? "orange.400" : "red.400"} 
          size="40px"
          thickness="10px"
        >
          <CircularProgressLabel fontSize="xs">
            {Math.ceil(remainingSeconds / 86400)}d
          </CircularProgressLabel>
        </CircularProgress>
        <VStack spacing={0} align="start">
          <Text fontSize="xs" color="gray.400">Locked</Text>
          <Text fontSize="sm" fontWeight="bold" color="orange.300">
            {bonusMultiplier > 1 ? `${bonusMultiplier.toFixed(2)}x bonus` : 'No bonus'}
          </Text>
        </VStack>
      </HStack>
    </Tooltip>
  );
};

// Cooldown indicator component
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
  
  // Calculate progress (0-100)
  const now = BigInt(Math.floor(Date.now() / 1000));
  const lastActionTimestamp = cooldownInfo.lastActionTimestamp;
  const cooldownDuration = endTimestamp - lastActionTimestamp;
  const elapsed = now - lastActionTimestamp;
  const progress = Math.min(100, Number(elapsed) * 100 / Number(cooldownDuration));
  
  return (
    <VStack spacing={0} align="start" w="100%">
      <HStack w="100%" justify="space-between">
        <Text fontSize="xs" color="gray.400">{label} Cooldown</Text>
        <Text fontSize="xs" color="teal.300">
          {formatDuration(endTimestamp - now)} left
        </Text>
      </HStack>
      <Progress 
        value={progress} 
        size="xs" 
        colorScheme="teal" 
        w="100%" 
        mt={1}
        borderRadius="full"
        hasStripe
        isAnimated
      />
    </VStack>
  );
};

// Helper function to get token logo URL
const getTokenLogo = (tokenSymbol: string): string => {
  if (tokenSymbol === 'SPARX') {
    return '/sparx-circle-logo.png';
  }
  if (tokenSymbol === 'XBURN') {
    return '/logo192.png';
  }
  // Default to SPARX logo if no match
  return '/sparx-circle-logo.png';
};

interface StakingPoolCardProps {
  data: {
    poolInfo: any;
    walletBalance: bigint | null;
    allowance: bigint | null;
    pendingRewards: bigint | null;
    stakedBalance: bigint | null;
    cooldownInfo: any | null;
    lockInfo: any | null;
    lockOptions: LockOption[];
    distributionShare?: bigint | null;
  };
  farmAddress: `0x${string}`;
  farmAbi: Abi;
  onSuccessfulTx: () => void;
  totalAllocPoint: bigint;
  currentRate: bigint;
  distributionShare: bigint | null;
}

// Main Component
export const StakingPoolCard: React.FC<StakingPoolCardProps> = ({ 
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
    cooldownInfo,
    lockInfo,
    lockOptions = []
  } = data;
  const { address: userAddress } = useAccount();
  const toast = useToast();
  const cardBg = useColorModeValue(darkCardBg, darkCardBg);
  const inputBg = useColorModeValue(darkInputBg, darkInputBg);
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
  // Default to no lock (index 0)
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number>(0);
  const [selectedLockTime, setSelectedLockTime] = useState<number>(0);

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
  const stakingTokenSymbol = poolInfo.token1Symbol;

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

  // --- Cooldown Timers ---
  const cooldownTimer = useCountdown(cooldownInfo?.cooldownEnds);
  const withdrawCooldownTimer = useCountdown(cooldownInfo?.withdrawCooldownEnds);
  const isStakeDisabled = cooldownInfo?.isCooldownActive ?? false;
  const isWithdrawDisabled = cooldownInfo?.isWithdrawCooldownActive ?? false;

  // --- Reward Share Formatting ---
  const rewardShareFormatted = useMemo(() => {
      if (distributionShare === null || typeof distributionShare === 'undefined') return 'N/A';
      // Value is in Basis Points (e.g., 3250 = 32.5%), divide by 100
      return `${Number(distributionShare) / 100}%`;
  }, [distributionShare]);

  // Get logo for the pool
  const poolLogo = useMemo(() => 
    getTokenLogo(poolInfo.token1Symbol), 
    [poolInfo.token1Symbol]
  );

  // Initialize lock options when they're loaded
  useEffect(() => {
    console.log("Lock options loaded:", lockOptions);
    // Default to first option (should be no lock / 0 days)
    if (lockOptions && lockOptions.length > 0) {
      setSelectedOptionIndex(0); // Always start with option index 0 (no lock)
      setSelectedLockTime(0);
    }
  }, [lockOptions]);

  // Handle lock option selection
  const handleLockOptionSelect = (index: number) => {
    console.log(`Selecting lock option index: ${index}`);
    setSelectedOptionIndex(index);
    
    // Update selected lock time based on index (used for UI)
    if (index === 0) setSelectedLockTime(0); // No lock
    else if (index === 1) setSelectedLockTime(1); // 1 day
    else if (index === 2) setSelectedLockTime(3); // 3 days
    else if (index === 3) setSelectedLockTime(7); // 7 days
  };

  // --- Event Handlers ---
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
      if (isStakeDisabled) { // Check Cooldown
          toast({ title: "Cooldown Active", description: `Please wait ${cooldownTimer} before staking again.`, status: "warning", duration: 5000, isClosable: true });
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
        
        // Check if we have valid lock options before proceeding
        if (!lockOptions || lockOptions.length === 0) {
          toast({ title: "Error", description: "No lock options available for this pool", status: "error" });
          return;
        }
        
        // Use the selected option index directly
        const optionIndex = selectedOptionIndex;
        console.log(`Staking with lock option index: ${optionIndex} (${formatDurationInDays(lockOptions[optionIndex].duration)} lock, ${formatBonus(lockOptions[optionIndex].bonusMultiplier)} bonus)`);
        
        // Update deposit call to include the optionIndex parameter
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
      if (isWithdrawDisabled) { // Check Cooldown
          toast({ title: "Cooldown Active", description: `Please wait ${withdrawCooldownTimer} before withdrawing again.`, status: "warning", duration: 5000, isClosable: true });
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
        description: isApprovalTx ? "Token approval successful. You can now proceed with staking." : "Staking operation completed.",
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
      borderRadius="lg" 
      p={5} 
      boxShadow="md"
      bg={darkCardBg} 
      borderColor={borderColor} 
      overflow="visible"
      transition='all 0.2s ease-out'
      _hover={{ borderColor: primaryColor, boxShadow: 'lg' }}
      position="relative"
      display="flex"
      flexDirection="column"
      minHeight="560px" // Added minHeight to help consistency
    >
      <VStack align="stretch" spacing={4} flexGrow={1}> 
        {/* Header */}
        <Flex justify="space-between" align="center">
          <HStack>
            <Image 
              src={poolLogo} 
              alt={`${poolInfo.name} logo`} 
              boxSize="32px" 
              borderRadius="full"
              mr={2}
            />
            <Heading size="md" color={sparxColor}>{poolInfo.name}</Heading>
          </HStack>
          <Text fontSize="xs" color={subtleTextColor}>PID: {poolInfo.pid}</Text>
        </Flex>

        {/* Stats Section */}
        <Grid templateColumns="repeat(2, 1fr)" gap={6}> 
          {/* Left column - Staked Balance & Reward Share */}
          <Box>
            <Text fontSize="sm" color={subtleTextColor} mb={1}>Staked Balance</Text>
            <Skeleton isLoaded={stakedBalance !== null}>
              <Text fontSize="xl" fontWeight="bold" color={lightTextColor}>
                {stakedBalanceFormatted} {stakingTokenSymbol}
              </Text>
            </Skeleton>
            
            <Box mt={3}>
              <Text fontSize="sm" color={subtleTextColor} mb={1}>Reward Share</Text>
              <Skeleton isLoaded={distributionShare !== null} minHeight="24px">
                <Box
                  bg={boostYellow}
                  color="black"
                  fontWeight="bold"
                  px={2}
                  py={0.5} 
                  borderRadius="md"
                  fontSize="xs"
                  display="inline-block"
                >
                  {rewardShareFormatted} BOOST
                </Box>
              </Skeleton>
            </Box>
          </Box>
          
          {/* Right column - Pending Rewards & Harvest Button */}
          <Box>
            <VStack align="flex-start" spacing={1}>
              <Text fontSize="sm" color={subtleTextColor} mb={1}>Pending Rewards</Text>
              <Skeleton isLoaded={pendingRewards !== null}>
                <VStack spacing={0} align="flex-start">
                  <Text fontSize="xl" fontWeight="bold" color={boostYellow}> 
                    {pendingRewardsFormatted} SPARX
                  </Text>
                  <Text fontSize="xs" color={subtleTextColor}>
                    ~${(parseFloat(pendingRewardsFormatted) * 0.015).toFixed(2)} USD
                  </Text>
                </VStack>
              </Skeleton>
              
              <Box height="8px" />
              
              <Box width="100%" minHeight="50px"> 
                <Button
                  size="sm"
                  width="full"
                  bg={buttonBrown}
                  color="white"
                  _hover={{ bg: buttonBrownHover }}
                  onClick={handleHarvest}
                  isDisabled={!userAddress || !hasPendingRewards || isTxLoading || cooldownInfo?.isCooldownActive}
                  isLoading={isTxLoading && hash && !isConfirmed}
                  borderRadius="md"
                >
                  Harvest
                </Button>
                
                {cooldownInfo?.isCooldownActive && hasPendingRewards && (
                  <Text 
                    fontSize="xs" 
                    fontWeight="medium"
                    color={primaryColor} 
                    textAlign="center"
                    mt={1}
                  >
                    Harvest in {formatDuration(cooldownInfo.cooldownEnds - BigInt(Math.floor(Date.now() / 1000)))}
                  </Text>
                )}
              </Box>
            </VStack>
          </Box>
        </Grid>

        <Divider borderColor={borderColor} />

        {/* Tabs for Stake/Unstake */}
        <Flex borderBottomWidth="1px" borderColor={borderColor}>
          <Button 
            flex="1" 
            variant="ghost" 
            fontWeight="medium"
            color={activeTab === 'stake' ? primaryColor : subtleTextColor}
            borderBottom={activeTab === 'stake' ? `2px solid ${primaryColor}` : '2px solid transparent'}
            borderRadius={0} 
            onClick={() => setActiveTab('stake')}
            _focus={{ boxShadow: 'none' }}
            _hover={{ bg: 'transparent', color: lightTextColor }} // Adjust hover
          >
            Stake
          </Button>
          <Button 
            flex="1"
            variant="ghost"
            fontWeight="medium"
            color={activeTab === 'unstake' ? primaryColor : subtleTextColor}
            borderBottom={activeTab === 'unstake' ? `2px solid ${primaryColor}` : '2px solid transparent'}
            borderRadius={0}
            onClick={() => setActiveTab('unstake')}
            _focus={{ boxShadow: 'none' }}
            _hover={{ bg: 'transparent', color: lightTextColor }} // Adjust hover
          >
            Unstake
          </Button>
        </Flex>

        {/* Tab Content Area */}
        <Box 
          p={4} 
          bg={darkInputBg} 
          borderRadius="md"
          borderWidth="1px"
          borderColor={borderColor}
          flexGrow={1}
          display="flex"
          flexDirection="column"
        >
          {activeTab === 'stake' ? (
            /* Stake Form */
            <VStack align="stretch" spacing={4} flex="1"> 
              <FormControl>
                <Flex justify="space-between" mb={1}>
                  <FormHelperText color={subtleTextColor}>Enter amount to stake</FormHelperText>
                  <FormHelperText color={lightTextColor}>Wallet: {walletBalanceFormatted} {stakingTokenSymbol}</FormHelperText>
                </Flex>
                <InputGroup>
                  <Input
                    placeholder={`Amount in ${stakingTokenSymbol}`}
                    bg={darkBg}
                    borderColor={borderColor}
                    color={lightTextColor}
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    type="number"
                    isDisabled={isTxLoading || !hasWalletBalance}
                    _focus={{ borderColor: primaryColor, boxShadow: `0 0 0 1px ${primaryColor}` }}
                    _hover={{ borderColor: lockBorderColor }}
                  />
                  <InputRightAddon 
                    bg={darkInputBg} 
                    borderColor={borderColor} 
                    px={2}
                    children={
                      <Button 
                        variant="ghost"
                        size="sm" 
                        color={primaryColor}
                        onClick={() => walletBalance && setStakeAmount(formatBigIntRaw(walletBalance))}
                        isDisabled={isTxLoading || !hasWalletBalance}
                        _hover={{ bg: 'gray.700' }} // Darker hover for MAX
                      >
                        MAX
                      </Button>
                    }
                  />
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

              {/* Lock Duration Selection */}
              <FormControl>
                <FormHelperText color={subtleTextColor} mb={2}>Lock Duration (higher = better rewards)</FormHelperText>
                <SimpleGrid columns={2} spacing={2}>
                  {/* No Lock Button */}
                  <Button 
                    size="sm" 
                    height="40px"
                    bg={selectedOptionIndex === 0 ? lockSelectedYellow : "transparent"}
                    color={selectedOptionIndex === 0 ? "black" : "white"}
                    border="1px solid"
                    borderColor={selectedOptionIndex === 0 ? lockSelectedYellow : lockBorderColor}
                    fontWeight="medium"
                    onClick={() => handleLockOptionSelect(0)}
                    _hover={{ 
                      bg: selectedOptionIndex === 0 ? lockSelectedYellow : 'gray.700', 
                      borderColor: selectedOptionIndex === 0 ? lockSelectedYellow : 'gray.500' 
                    }}
                  >
                    No Lock
                  </Button>
                  {/* 1d Button */}
                  <Button 
                    size="sm" 
                    height="40px"
                    bg="transparent" 
                    color="white"
                    border="1px solid"
                    borderColor={selectedOptionIndex === 1 ? primaryColor : lockBorderColor} 
                    fontWeight="medium"
                    onClick={() => handleLockOptionSelect(1)}
                    _hover={{ bg: "gray.700", borderColor: selectedOptionIndex === 1 ? primaryColor : 'gray.500' }}
                  >
                    1d (+50%)
                  </Button>
                  {/* 3d Button */}
                  <Button 
                    size="sm" 
                    height="40px"
                    bg="transparent"
                    color="white"
                    border="1px solid"
                    borderColor={selectedOptionIndex === 2 ? primaryColor : lockBorderColor} 
                    fontWeight="medium"
                    onClick={() => handleLockOptionSelect(2)}
                    _hover={{ bg: "gray.700", borderColor: selectedOptionIndex === 2 ? primaryColor : 'gray.500' }}
                  >
                    3d (+100%)
                  </Button>
                  {/* 7d Button */}
                  <Button 
                    size="sm" 
                    height="40px"
                    bg="transparent"
                    color="white"
                    border="1px solid"
                    borderColor={selectedOptionIndex === 3 ? primaryColor : lockBorderColor} 
                    fontWeight="medium"
                    onClick={() => handleLockOptionSelect(3)}
                    _hover={{ bg: "gray.700", borderColor: selectedOptionIndex === 3 ? primaryColor : 'gray.500' }}
                  >
                    7d (+200%)
                  </Button>
                </SimpleGrid>
              </FormControl>

              <Spacer />

              {/* Stake/Approve Buttons */}
              <VStack spacing={2}> 
                {showApproveButton ? (
                  <Button 
                    w="full" 
                    h="45px"
                    bg={buttonBrown}
                    color="white"
                    _hover={{ bg: buttonBrownHover }}
                    onClick={handleApprove}
                    isLoading={isTxLoading && hash !== null}
                    isDisabled={!userAddress || isTxLoading || !hasWalletBalance}
                    borderRadius="md"
                  >
                    Approve {stakingTokenSymbol}
                  </Button>
                ) : (
                  <Button 
                    w="full" 
                    h="45px"
                    bg={buttonBrown} // Back to brown as per screenshot
                    color="white"
                    _hover={{ bg: buttonBrownHover }} 
                    onClick={handleStake}
                    isLoading={isTxLoading}
                    isDisabled={!userAddress || isTxLoading || !hasWalletBalance || stakeAmountNum <= 0}
                    borderRadius="md"
                  >
                    Stake {stakingTokenSymbol}
                  </Button>
                )}
                
                {/* Stake Cooldown Timer */}
                {isStakeDisabled && (
                  <Text fontSize="xs" color={cooldownTextColor} textAlign="center" mt={0} pt={0}>
                    Cooldown: {cooldownTimer}
                  </Text>
                )}
              </VStack>
            </VStack>
          ) : (
            /* Unstake Form */
            <VStack align="stretch" spacing={4} flex="1"> 
              <FormControl>
                <Flex justify="space-between" mb={1}>
                  <FormHelperText color={subtleTextColor}>Enter amount to unstake</FormHelperText>
                  <FormHelperText color={lightTextColor}>Staked: {stakedBalanceFormatted} {stakingTokenSymbol}</FormHelperText>
                </Flex>
                <InputGroup>
                  <Input
                    placeholder={`Amount in ${stakingTokenSymbol}`}
                    bg={darkBg}
                    borderColor={borderColor}
                    color={lightTextColor}
                    value={unstakeAmount}
                    onChange={(e) => setUnstakeAmount(e.target.value)}
                    type="number"
                    isDisabled={isTxLoading || !hasStakedBalance}
                    _focus={{ borderColor: primaryColor, boxShadow: `0 0 0 1px ${primaryColor}` }}
                    _hover={{ borderColor: lockBorderColor }}
                  />
                  <InputRightAddon 
                    bg={darkInputBg} 
                    borderColor={borderColor} 
                    px={2}
                    children={
                      <Button 
                        variant="ghost"
                        size="sm" 
                        color={primaryColor}
                        onClick={() => stakedBalance && setUnstakeAmount(formatBigIntRaw(stakedBalance))}
                        isDisabled={isTxLoading || !hasStakedBalance}
                         _hover={{ bg: 'gray.700' }} // Darker hover for MAX
                      >
                        MAX
                      </Button>
                    }
                  />
                </InputGroup>
              </FormControl>

              <Spacer />

              {/* Main Unstake Button */}
              <Button 
                w="full"
                h="45px"
                bg={buttonRed}
                color="white"
                _hover={{ bg: buttonRedHover }}
                onClick={handleUnstake}
                isDisabled={!userAddress || !unstakeAmount || unstakeAmountNum <= 0 || !hasStakedBalance || isTxLoading}
                isLoading={isTxLoading && hash && !isConfirmed && unstakeAmountNum > 0}
                borderRadius="md"
              >
                Unstake {stakingTokenSymbol}
              </Button>

              {/* Withdraw Cooldown Timer */}
              {isWithdrawDisabled && (
                <Text fontSize="xs" color={cooldownTextColor} textAlign="center" mt={0} pt={0}>
                  Withdraw Cooldown: {withdrawCooldownTimer}
                </Text>
              )}
            </VStack>
          )}
        </Box>

        {/* Bottom Status Badges */} 
        <HStack spacing={2} justify="space-between" pt={1} px={2} mt="auto"> 
          {/* Left side - Lock status */}
          {data.lockInfo && data.lockInfo.secondsRemaining > 0n ? (
            <Box bg={statusLockedBg} px={3} py={1.5} fontSize="xs" borderRadius="md" textTransform="uppercase">
              <Text color="white" fontWeight="medium">Locked</Text>
            </Box>
          ) : hasStakedBalance ? (
            <Box bg={statusNotLockedBg} px={3} py={1.5} fontSize="xs" borderRadius="md" textTransform="uppercase">
              <Text color="white" fontWeight="medium">Not Locked</Text>
            </Box>
          ) : (
            <Box minW="70px" /> /* Placeholder with min width */
          )}
          
          {/* Center - Stake cooldown */}
          {cooldownInfo?.isCooldownActive ? (
            <Box bg={statusStakeCdBg} px={3} py={1.5} fontSize="xs" borderRadius="md" textTransform="uppercase">
              <Text color="white" fontWeight="medium">
                Stake in {formatDuration(cooldownInfo.cooldownEnds - BigInt(Math.floor(Date.now() / 1000)))}
              </Text>
            </Box>
          ) : (
            <Box minW="70px" /> /* Placeholder with min width */
          )}
          
          {/* Right - Withdraw cooldown */}
          {cooldownInfo?.isWithdrawCooldownActive ? (
            <Box bg={statusWithdrawCdBg} px={3} py={1.5} fontSize="xs" borderRadius="md" textTransform="uppercase">
              <Text color="white" fontWeight="medium">
                Withdraw in {formatDuration(cooldownInfo.withdrawCooldownEnds - BigInt(Math.floor(Date.now() / 1000)))}
              </Text>
            </Box>
          ) : (
            <Box minW="70px" /> /* Placeholder with min width */
          )}
        </HStack>
      </VStack>
    </Box>
  ); 
}; 