import {
    Box,
    SimpleGrid,
    Stat,
    StatLabel,
    StatNumber,
    StatHelpText,
    Skeleton,
    useColorModeValue,
    Progress,
    Text,
    VStack,
    Badge,
    Flex,
    Tooltip
} from '@chakra-ui/react';
import { useMemo } from 'react';
import { formatUnits } from 'viem';
import { useCountdown } from '../../hooks/useCountdown';
import { FarmStatsData } from './FarmTab'; // Import from FarmTab now

// Define theme colors locally
const accentColor = '#FF6937'; // Fiery orange-red
const sparxColor = '#FFA500'; // Yellow-orange
const lightTextColor = 'gray.200';
const subtleTextColor = 'gray.400';
const darkCardBg = '#2D3748';
const borderColor = '#4A5568';
const progressColorScheme = 'orange'; // Use orange theme for progress
const enabledColor = 'green.400';
const disabledColor = 'red.400';

interface FarmStatsBannerProps {
    data: FarmStatsData | null;
    isLoading: boolean;
}

// Helper to format large numbers (can be moved to a utils file)
function formatLargeNumber(value: bigint | null | undefined, decimals = 18): string {
    if (value === null || typeof value === 'undefined') return '...';
    const num = parseFloat(formatUnits(value, decimals));
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(0); // Show whole numbers for supply
}

const FarmStatsBanner: React.FC<FarmStatsBannerProps> = ({ data, isLoading }) => {
    const bg = useColorModeValue('orange.50', darkCardBg); // Lighter orange for light mode, dark for dark
    const headingColor = useColorModeValue('orange.700', accentColor);
    const textColor = useColorModeValue('gray.600', subtleTextColor);

    const emissionRatePerDay = useMemo(() => {
        if (!data?.currentRate) return null;
        const ratePerSecond = data.currentRate;
        const ratePerDay = ratePerSecond * BigInt(60 * 60 * 24);
        return ratePerDay;
    }, [data?.currentRate]);

    const phaseEndTimer = useCountdown(data?.currentPhaseEnd);
    const phaseEndDateFormatted = useMemo(() => {
        if (!data?.currentPhaseEnd) return 'N/A';
        try {
            const date = new Date(Number(data.currentPhaseEnd * 1000n));
            return date.toLocaleString();
        } catch {
            return 'Invalid Date';
        }
    }, [data?.currentPhaseEnd]);

    const mintedPercent = useMemo(() => {
        if (!data?.farmCap || !data?.farmMinted || data.farmCap === 0n) return 0;
        // Use floating point for percentage calculation to avoid BigInt issues
        const mintedNum = parseFloat(formatUnits(data.farmMinted, 18));
        const capNum = parseFloat(formatUnits(data.farmCap, 18));
        if (capNum === 0) return 0;
        return Math.min(((mintedNum / capNum) * 100), 100); // Cap at 100%
    }, [data?.farmCap, data?.farmMinted]);

    // New: Format the phase information
    const phaseText = useMemo(() => {
        if (data?.currentPhaseIndex === undefined) return 'Loading...';
        return `Phase ${data.currentPhaseIndex + 1}`; // +1 for human-readable index
    }, [data?.currentPhaseIndex]);

    return (
        <Box bg={bg} borderRadius="xl" p={5} mb={6} borderColor={borderColor} borderWidth="1px">
            {/* Removed Phase Timeline */}
            
            <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} spacing={5}>
                {/* Emission Rate */}
                <Stat>
                    <StatLabel color={textColor}>Current Emission Rate</StatLabel>
                    <Skeleton isLoaded={!isLoading} minHeight="24px">
                        <StatNumber color={headingColor}>
                            {formatLargeNumber(emissionRatePerDay)} SPARX / Day
                        </StatNumber>
                    </Skeleton>
                    <StatHelpText color={textColor}>
                        {phaseText}
                        {data?.hasNewFarm && (
                            <Badge ml={2} colorScheme="green">New Farm Available</Badge>
                        )}
                    </StatHelpText>
                </Stat>

                {/* Current Phase End */}
                <Stat>
                    <StatLabel color={textColor}>Current Phase Ends</StatLabel>
                     <Skeleton isLoaded={!isLoading} minHeight="24px">
                        <StatNumber color={headingColor}>
                             {phaseEndTimer === 'Ready' ? 'Ended' : phaseEndTimer}
                        </StatNumber>
                    </Skeleton>
                    <StatHelpText color={textColor}>{phaseEndDateFormatted}</StatHelpText>
                </Stat>

                {/* Minted Progress */}
                 <Stat>
                    <StatLabel color={textColor}>Farm Emissions Progress</StatLabel>
                     <Skeleton isLoaded={!isLoading} height="40px">
                        <VStack align="stretch" spacing={1} mt={1}>
                             <Progress 
                                value={mintedPercent}
                                size="sm" 
                                colorScheme={progressColorScheme} 
                                borderRadius="md" 
                                hasStripe 
                                isAnimated={mintedPercent > 0 && mintedPercent < 100}
                             />
                             <Text fontSize="xs" color={textColor} textAlign="right">
                                {formatLargeNumber(data?.farmMinted)} / {formatLargeNumber(data?.farmCap)} ({mintedPercent.toFixed(1)}%)
                             </Text>
                        </VStack>
                    </Skeleton>
                    <StatHelpText color={data?.depositsEnabled ? enabledColor : disabledColor}>
                        Deposits: {isLoading ? '...' : data?.depositsEnabled ? 'Enabled' : 'Disabled'}
                    </StatHelpText>
                </Stat>

                {/* Phase Completion */}
                <Stat>
                    <StatLabel color={textColor}>Phase Completion</StatLabel>
                    <Skeleton isLoaded={!isLoading} height="40px">
                        <VStack align="stretch" spacing={1} mt={1}>
                            <Progress 
                                value={data?.percentComplete ?? 0}
                                size="sm" 
                                colorScheme="blue" 
                                borderRadius="md" 
                                hasStripe 
                                isAnimated={true}
                            />
                            <Text fontSize="xs" color={textColor} textAlign="right">
                                {data?.percentComplete?.toFixed(1) ?? 0}% Complete
                            </Text>
                        </VStack>
                    </Skeleton>
                    <StatHelpText color={textColor}>
                        {data?.secondsRemaining 
                            ? `${Math.floor(Number(data.secondsRemaining) / 86400)} days remaining` 
                            : '...'}
                    </StatHelpText>
                </Stat>
            </SimpleGrid>
        </Box>
    );
};

export default FarmStatsBanner; 