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

// Define theme colors - updated for fire theme
const primaryColor = '#FF6937';          // Fiery orange-red (XBURN primary)
const sparxColor = '#FFA500';            // Yellow-orange (SPARX primary)
const accentColor = '#FF6937';           // Use primaryColor as main accent
const darkBg = '#1A202C';               // Darker background
const darkCardBg = '#2D3748';           // Slightly lighter card background
const darkInputBg = '#1A202C';          // Dark input background
const borderColor = '#4A5568';          // Slightly lighter border color for contrast
const burnRed = '#E53E3E';               // Adjusted red for better visibility
const burnOrange = '#DD6B20';            // Adjusted orange for better visibility
const lightTextColor = 'gray.200';       // Main text color on dark BG
const subtleTextColor = 'gray.400';      // Helper text color
const countdownColor = 'teal.300';       // Color for countdown timers

// Define the target color from PoolCard heading
const targetColor = 'brand.400'; // #FFCA28 - The yellow color

// Helper component for key-value display
const DataRow: React.FC<{ label: string; children: React.ReactNode; isLoading?: boolean; labelColor?: string; valueColor?: string, labelSize?: string; valueSize?: string; valueWeight?: string }> = ({ 
    label, children, isLoading = false, labelColor = subtleTextColor, valueColor, labelSize = "sm", valueSize="md", valueWeight="medium" 
}) => (
    <Flex justify="space-between" align="center" w="full">
        <Text fontSize={labelSize} color={labelColor}>{label}</Text>
        <Skeleton isLoaded={!isLoading}>
             <Text fontSize={valueSize} fontWeight={valueWeight} color={valueColor} textAlign="right">{children}</Text>
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
  data: FarmPoolCardData;
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
    cooldownInfo
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
  const stakingTokenSymbol = poolInfo.token1Symbol;

  const formatBigIntDisplay = (value: bigint | null | undefined, decimals = 18, displayDecimals = 4) => {
    if (value === null || typeof value === 'undefined') return '0.0'.padEnd(displayDecimals + 2, '0');
    const formatted = formatUnits(value, decimals);
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

  // --- Event Handlers ---
  const handleApprove = () => writeContract({ 
      address: stakingTokenAddress, 
      abi: erc20AbiDirect, 
      functionName: 'approve', 
      args: [farmAddress, maxUint256] 
  });
  
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
        
        // If selected lock time is 0, use regular deposit function
        if (selectedLockTime === 0) {
          writeContract({ address: farmAddress, abi: farmAbi, functionName: 'deposit', args: [BigInt(poolInfo.pid), amountParsed] });
        } else {
          // Use depositWithLock function with selected lock duration (in days)
          const lockDurationInDays = BigInt(selectedLockTime);
          writeContract({ 
            address: farmAddress, 
            abi: farmAbi, 
            functionName: 'depositWithLock', 
            args: [BigInt(poolInfo.pid), amountParsed, lockDurationInDays] 
          });
        }
      } catch { toast({ title: "Invalid stake amount", status: "error" }); }
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
      toast({ title: 'Transaction Successful', status: 'success', duration: 5000 });
      onSuccessfulTx(); setStakeAmount(''); setUnstakeAmount('');
    }
    const txError = writeError || confirmationError;
    if (txError) {
      const message = txError instanceof BaseError ? txError.shortMessage : txError?.message || 'Unknown error';
      toast({ title: 'Transaction Failed', description: message, status: 'error', duration: 7000 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed, writeError, confirmationError]);

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
      <VStack align="stretch" spacing={4}> 
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
            <Heading size="md" sx={fireHeadingText}>{poolInfo.name}</Heading>
          </HStack>
          <Text fontSize="xs" color={subtleTextColor}>PID: {poolInfo.pid}</Text>
        </Flex>

        {/* Stats Section */}
        <Grid templateColumns="repeat(2, 1fr)" gap={4}>
          {/* Left column - Staked Balance & Reward Share */}
          <Box>
            <Text fontSize="sm" color={subtleTextColor} mb={1}>Staked Balance</Text>
            <Skeleton isLoaded={stakedBalance !== null}>
              <Text fontSize="xl" fontWeight="bold" color={lightTextColor}>
                {stakedBalanceFormatted} {stakingTokenSymbol}
              </Text>
            </Skeleton>
            
            {/* Reward Share Display */}
            <Box mt={3}>
              <Text fontSize="sm" color={subtleTextColor} mb={1}>Reward Share</Text>
              <Skeleton isLoaded={distributionShare !== null} minHeight="24px">
                <HStack>
                  <Text fontSize="xl" fontWeight="bold" color="yellow.400">{rewardShareFormatted}</Text>
                  <Tooltip label="Percentage of total farm rewards allocated to this pool">
                    <Badge colorScheme="yellow" variant="outline">
                      Pool Allocation
                    </Badge>
                  </Tooltip>
                </HStack>
              </Skeleton>
            </Box>
          </Box>
          
          {/* Right column - Pending Rewards & Harvest Button */}
          <Box>
            <HStack justify="space-between" align="flex-start" spacing={2}>
              {/* Pending Rewards */}
              <VStack align="flex-start" spacing={0}>
                 <Text fontSize="sm" color={subtleTextColor} mb={1}>Pending Rewards</Text>
                 <Skeleton isLoaded={pendingRewards !== null}>
                    <Text fontSize="lg" fontWeight="bold" sx={sparxNumberText}>
                      {pendingRewardsFormatted} SPARX
                    </Text>
                  </Skeleton>
              </VStack>
              <Spacer />
            </HStack>
            {/* Harvest Button below rewards */}
            <Button
                mt={3}
                w="full"
                size="sm"
                bg={sparxColor}
                color="black"
                _hover={{ bg: 'yellow.500', boxShadow: `0 0 10px ${sparxColor}aa` }}
                _active={{ bg: 'yellow.600' }}
                onClick={handleHarvest}
                isDisabled={!userAddress || !hasPendingRewards || isTxLoading}
                isLoading={isTxLoading && hash && !isConfirmed}
              >
                Harvest
              </Button>
          </Box>
        </Grid>

        <Divider borderColor={borderColor} />

        {/* Tabs for Stake/Unstake */}
        <Flex>
          <Button 
            flex="1" 
            variant={activeTab === 'stake' ? 'solid' : 'ghost'} 
            bg={activeTab === 'stake' ? 'transparent' : 'transparent'}
            color={activeTab === 'stake' ? fireColor : subtleTextColor}
            borderBottom={activeTab === 'stake' ? `2px solid ${fireColor}` : '2px solid transparent'}
            borderRadius="0"
            _hover={{ bg: 'gray.700', color: 'white' }}
            onClick={() => setActiveTab('stake')}
          >
            Stake
          </Button>
          <Button 
            flex="1" 
            variant={activeTab === 'unstake' ? 'solid' : 'ghost'} 
            bg={activeTab === 'unstake' ? 'transparent' : 'transparent'}
            color={activeTab === 'unstake' ? fireColor : subtleTextColor}
            borderBottom={activeTab === 'unstake' ? `2px solid ${fireColor}` : '2px solid transparent'}
            borderRadius="0"
            _hover={{ bg: 'gray.700', color: 'white' }}
            onClick={() => setActiveTab('unstake')}
          >
            Unstake
          </Button>
        </Flex>

        {/* Tab Content Area */}
        <Box 
          p={5} 
          bg={darkInputBg} 
          borderRadius="md"
        >
          {activeTab === 'stake' ? (
            /* Stake Form */
            <VStack align="stretch" spacing={4}>
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
                    _focus={{ borderColor: fireColor }}
                    _hover={{ borderColor: 'gray.500' }}
                  />
                  <InputRightAddon bg={darkInputBg} borderColor={borderColor} p={0}>
                    <Button 
                      h="full"
                      size="sm" 
                      bg="transparent"
                      color={fireColor}
                      borderLeftColor={borderColor}
                      _hover={{ bg: 'gray.700' }}
                      isDisabled={isTxLoading || !hasWalletBalance}
                      onClick={() => walletBalance && setStakeAmount(formatBigIntRaw(walletBalance))}
                    >
                      MAX
                    </Button>
                  </InputRightAddon>
                </InputGroup>
              </FormControl>

              {/* Lock Time Selection */}
              <FormControl>
                <FormHelperText color={subtleTextColor} mb={2}>Select lock duration (optional)</FormHelperText>
                <Flex gap={2}>
                  <Button 
                    size="sm" 
                    variant={selectedLockTime === 0 ? "solid" : "outline"}
                    colorScheme={selectedLockTime === 0 ? "green" : "gray"}
                    onClick={() => setSelectedLockTime(0)}
                  >
                    No Lock
                  </Button>
                  <Button 
                    size="sm" 
                    variant={selectedLockTime === 3 ? "solid" : "outline"}
                    colorScheme={selectedLockTime === 3 ? "yellow" : "gray"}
                    onClick={() => setSelectedLockTime(3)}
                  >
                    3 Days
                  </Button>
                  <Button 
                    size="sm" 
                    variant={selectedLockTime === 7 ? "solid" : "outline"}
                    colorScheme={selectedLockTime === 7 ? "orange" : "gray"}
                    onClick={() => setSelectedLockTime(7)}
                  >
                    7 Days
                  </Button>
                  <Button 
                    size="sm" 
                    variant={selectedLockTime === 30 ? "solid" : "outline"}
                    colorScheme={selectedLockTime === 30 ? "red" : "gray"}
                    onClick={() => setSelectedLockTime(30)}
                  >
                    30 Days
                  </Button>
                </Flex>
                <Text fontSize="xs" color="yellow.300" mt={1}>
                  {selectedLockTime === 0 ? 'No bonus' : 
                   selectedLockTime === 3 ? '+10% reward bonus' : 
                   selectedLockTime === 7 ? '+25% reward bonus' : 
                   selectedLockTime === 30 ? '+50% reward bonus' : ''}
                </Text>
              </FormControl>

              {/* Stake Action Buttons */}
              <Box>
                {showApproveButton ? (
                  <Button 
                    w="full" 
                    bg={sparxColor} 
                    color="black" 
                    _hover={{ bg: 'yellow.500', boxShadow: `0 0 12px ${sparxColor}cc` }}
                    _active={{ bg: 'yellow.600' }}
                    onClick={handleApprove}
                    isLoading={isTxLoading && hash !== null}
                    isDisabled={!userAddress || isTxLoading || !hasWalletBalance}
                  >
                    Approve {stakingTokenSymbol}
                  </Button>
                ) : (
                  <Button 
                    w="full" 
                    bg={burnOrange} 
                    color="white" 
                    _hover={{ bg: 'orange.600', boxShadow: `0 0 12px ${burnOrange}cc` }}
                    _active={{ bg: 'orange.700' }}
                    onClick={handleStake}
                    isLoading={isTxLoading}
                    isDisabled={!userAddress || isTxLoading || !hasWalletBalance || stakeAmountNum <= 0}
                  >
                    Stake {stakingTokenSymbol}
                  </Button>
                )}
              </Box>
              
              {hasPendingRewards && !showApproveButton && stakeAmountNum > 0 && (
                <Text fontSize="sm" color={sparxColor} textAlign="center">
                  Harvest recommended before staking more
                </Text>
              )}
              {/* Cooldown Timer Display */}
              {isStakeDisabled && (
                  <Text fontSize="xs" color={countdownColor} textAlign="center" mt={1}>
                      Cooldown: {cooldownTimer}
                  </Text>
              )}
            </VStack>
          ) : (
            /* Unstake Form */
            <VStack align="stretch" spacing={4}>
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
                    _focus={{ borderColor: fireColor }}
                    _hover={{ borderColor: 'gray.500' }}
                  />
                  <InputRightAddon bg={darkInputBg} borderColor={borderColor} p={0}>
                    <Button 
                      h="full"
                      size="sm" 
                      bg="transparent"
                      color={fireColor}
                      borderLeftColor={borderColor}
                      _hover={{ bg: 'gray.700' }}
                      isDisabled={isTxLoading || !hasStakedBalance}
                      onClick={() => stakedBalance && setUnstakeAmount(formatBigIntRaw(stakedBalance))}
                    >
                      MAX
                    </Button>
                  </InputRightAddon>
                </InputGroup>
              </FormControl>

              <Button 
                bg={burnRed}
                color="white" 
                _hover={{ bg: 'red.600', boxShadow: `0 0 12px ${burnRed}cc` }}
                _active={{ bg: 'red.700' }}
                onClick={handleUnstake}
                isDisabled={!userAddress || !unstakeAmount || unstakeAmountNum <= 0 || !hasStakedBalance || isTxLoading}
                isLoading={isTxLoading && hash && !isConfirmed && unstakeAmountNum > 0}
                size="lg"
              >
                Unstake {stakingTokenSymbol}
              </Button>
              {/* Cooldown Timer Display */}
               {isWithdrawDisabled && (
                  <Text fontSize="xs" color={countdownColor} textAlign="center" mt={1}>
                      Withdraw Cooldown: {withdrawCooldownTimer}
                  </Text>
              )}
            </VStack>
          )}
        </Box>

        {/* New section for lock status and cooldowns */}
        <Box p={4} bg="gray.700" borderRadius="md">
          <HStack spacing={4} justify="space-between">
            <LockStatusIndicator lockInfo={data.lockInfo} isLoading={false} />
            
            <VStack spacing={2} align="stretch" flex={1}>
              {/* Only show cooldown indicators if relevant cooldowns are active */}
              {cooldownInfo && (
                <>
                  <CooldownIndicator cooldownInfo={cooldownInfo} label="Stake" />
                  <CooldownIndicator cooldownInfo={cooldownInfo} label="Withdraw" />
                </>
              )}
            </VStack>
          </HStack>
        </Box>
      </VStack>
    </Box>
  );
}; 