import React, { useEffect } from 'react';
import {
    Box,
    Container,
    Flex,
    Heading,
    Spacer,
    HStack,
    useColorModeValue,
    Image,
    Link,
    Button,
    Text,
    Divider,
    Tooltip,
    Badge,
    useDisclosure,
    Icon,
} from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import { useMemo } from 'react';
import { getAddressesForChain, isContractDeployed } from '../config/contracts';
import { FaBook, FaEthereum } from 'react-icons/fa';

// Define animations
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
`;

const Header: React.FC = () => {
    const headerBg = useColorModeValue('gray.800', 'gray.800'); // Consistent dark header
    const borderColor = useColorModeValue('gray.700', 'gray.700');
    const hoverBg = useColorModeValue('gray.700', 'gray.600');
    const fireColor = '#FF6937'; // Accent color
    const linkColor = useColorModeValue('gray.300', 'gray.300'); // Changed from white to light gray
    const subtleGradient = 'linear-gradient(90deg, rgba(255,105,55,0.1) 0%, rgba(255,105,55,0.3) 100%)';
    
    const { address: userAddress, chain, isConnected } = useAccount();
    const currentAddresses = useMemo(() => getAddressesForChain(chain?.id), [chain?.id]);
    
    // Define token addresses
    const sparxAddress = useMemo(() => 
        isContractDeployed(currentAddresses.sparx) ? currentAddresses.sparx as `0x${string}` : undefined, 
    [currentAddresses]);
    
    const xburnAddress = useMemo(() => 
        isContractDeployed(currentAddresses.xburn) ? currentAddresses.xburn as `0x${string}` : undefined, 
    [currentAddresses]);
    
    // Get balances
    const { data: ethBalance } = useBalance({
        address: userAddress,
        query: { enabled: !!userAddress }
    });
    
    const { data: sparxBalance } = useBalance({
        address: userAddress,
        token: sparxAddress,
        query: { enabled: !!userAddress && !!sparxAddress }
    });
    
    const { data: xburnBalance } = useBalance({
        address: userAddress,
        token: xburnAddress,
        query: { enabled: !!userAddress && !!xburnAddress }
    });
    
    // Format balances
    const formatBalance = (balance?: bigint, decimals: number = 18) => {
        if (!balance) return "0.00";
        const formatted = formatUnits(balance, decimals);
        const [whole, fraction] = formatted.split('.');
        return `${whole}.${fraction?.substring(0, 2) || '00'}`;
    };
    
    const ethFormattedBalance = useMemo(() => 
        formatBalance(ethBalance?.value), 
    [ethBalance]);
    
    const sparxFormattedBalance = useMemo(() => 
        formatBalance(sparxBalance?.value), 
    [sparxBalance]);
    
    const xburnFormattedBalance = useMemo(() => 
        formatBalance(xburnBalance?.value), 
    [xburnBalance]);

    // Mock USD prices for tooltip display
    const mockPrices = {
        ETH: 3490,
        SPARX: 0.05,
        XBURN: 0.12
    };

    // Approximate USD values
    const getUSDValue = (amount: string, token: 'ETH' | 'SPARX' | 'XBURN') => {
        const value = parseFloat(amount) * mockPrices[token];
        return value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`;
    };

    const ethUsdValue = useMemo(() => getUSDValue(ethFormattedBalance, 'ETH'), [ethFormattedBalance]);
    const sparxUsdValue = useMemo(() => getUSDValue(sparxFormattedBalance, 'SPARX'), [sparxFormattedBalance]);
    const xburnUsdValue = useMemo(() => getUSDValue(xburnFormattedBalance, 'XBURN'), [xburnFormattedBalance]);

    // Get chain name for display
    const networkName = useMemo(() => {
        if (!chain) return 'Not Connected';
        return chain.name === 'Sepolia' ? 'Sepolia Testnet' : chain.name;
    }, [chain]);

    // Function to truncate wallet address
    const truncateAddress = (address: string) => {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    return (
        <Box 
            borderBottomWidth="1px" 
            borderColor={borderColor} 
            bg={headerBg} 
            position="sticky" 
            top="0" 
            zIndex="banner"
            boxShadow="md"
        >
            <Container maxW="container.xl" py={3}>
                <Flex w="full" alignItems="center" px={{ base: 2, md: 4 }}>
                    {/* Logo and Brand with animation */}
                    <Link href="https://burnxen.com" isExternal _hover={{ textDecoration: 'none' }}>
                        <HStack spacing={3}>
                            <Box position="relative">
                                <Image 
                                    src="/sparx-circle-logo.png" 
                                    alt="SPARX Logo" 
                                    boxSize={{ base: '35px', md: '50px' }} 
                                    transition="transform 0.3s"
                                    _hover={{ transform: 'scale(1.1)' }}
                                />
                            </Box>
                            <Heading 
                                size={{ base: 'sm', md: 'md' }} 
                                color={fireColor} 
                                display={{ base: 'none', sm: 'block' }}
                                _hover={{ color: 'orange.300' }}
                                transition="color 0.3s, transform 0.3s"
                                textShadow="0 0 5px rgba(255,105,55,0.3)"
                            >
                                XenFerno Farms
                            </Heading>
                        </HStack>
                    </Link>

                    <Spacer />

                    {/* Navigation Links with improved hover effects */}
                    <HStack spacing={{ base: 2, md: 5 }} mx={{ base: 2, md: 6 }}>
                        <Link 
                            href="https://burnxen.com" 
                            fontWeight="bold" 
                            fontSize={{ base: 'sm', md: 'md' }} 
                            position="relative"
                            transition="transform 0.3s"
                            color={linkColor}
                            _hover={{ 
                                color: fireColor, 
                                textDecoration: 'none',
                                transform: 'translateY(-2px)'
                            }}
                            _after={{
                                content: '""',
                                position: 'absolute',
                                width: '0%',
                                height: '2px',
                                bottom: '-5px',
                                left: '0',
                                bg: fireColor,
                                transition: 'width 0.3s ease'
                            }}
                            sx={{
                                '&:hover::after': {
                                    width: '100%'
                                }
                            }}
                        >
                            BurnXen.com
                        </Link>
                        <Link 
                            href="https://x.com/BurnMoreXen" 
                            isExternal 
                            fontWeight="bold" 
                            fontSize={{ base: 'sm', md: 'md' }} 
                            position="relative"
                            transition="transform 0.3s"
                            color={linkColor}
                            _hover={{ 
                                color: fireColor, 
                                textDecoration: 'none',
                                transform: 'translateY(-2px)'
                            }}
                            _after={{
                                content: '""',
                                position: 'absolute',
                                width: '0%',
                                height: '2px',
                                bottom: '-5px',
                                left: '0',
                                bg: fireColor,
                                transition: 'width 0.3s ease'
                            }}
                            sx={{
                                '&:hover::after': {
                                    width: '100%'
                                }
                            }}
                        >
                            X
                        </Link>
                        <Link 
                            href="https://t.me/BurnMoreXen" 
                            isExternal 
                            fontWeight="bold" 
                            fontSize={{ base: 'sm', md: 'md' }} 
                            position="relative"
                            transition="transform 0.3s"
                            color={linkColor}
                            _hover={{ 
                                color: fireColor, 
                                textDecoration: 'none',
                                transform: 'translateY(-2px)'
                            }}
                            _after={{
                                content: '""',
                                position: 'absolute',
                                width: '0%',
                                height: '2px',
                                bottom: '-5px',
                                left: '0',
                                bg: fireColor,
                                transition: 'width 0.3s ease'
                            }}
                            sx={{
                                '&:hover::after': {
                                    width: '100%'
                                }
                            }}
                        >
                            TG
                        </Link>
                        <Link 
                            href="https://xenburner.gitbook.io/sparx" 
                            isExternal 
                            fontWeight="bold" 
                            fontSize={{ base: 'sm', md: 'md' }} 
                            display="flex"
                            alignItems="center"
                            position="relative"
                            transition="transform 0.3s"
                            color={linkColor}
                            _hover={{ 
                                color: fireColor, 
                                textDecoration: 'none',
                                transform: 'translateY(-2px)'
                            }}
                            _after={{
                                content: '""',
                                position: 'absolute',
                                width: '0%',
                                height: '2px',
                                bottom: '-5px',
                                left: '0',
                                bg: fireColor,
                                transition: 'width 0.3s ease'
                            }}
                            sx={{
                                '&:hover::after': {
                                    width: '100%'
                                }
                            }}
                        >
                            <Box as={FaBook} mr={1} />
                            Gitbook
                        </Link>
                    </HStack>
                    
                    {/* Network Indicator */}
                    {isConnected && chain && (
                        <Badge 
                            mr={4} 
                            colorScheme={chain.id === 11155111 ? "blue" : "green"}
                            borderRadius="full"
                            px={2}
                            py={1}
                            fontSize="xs"
                            display={{ base: 'none', lg: 'block' }}
                        >
                            {networkName}
                        </Badge>
                    )}
                    
                    {/* Token Balances - Enhanced with better styling */}
                    {userAddress && (
                        <HStack 
                            spacing={3} 
                            mr={4} 
                            display={{ base: 'none', md: 'flex' }}
                            bg="gray.800" 
                            p={2} 
                            px={3}
                            borderRadius="md"
                            borderWidth="1px"
                            borderColor="gray.700"
                            boxShadow="0px 2px 4px rgba(0,0,0,0.2)"
                        >
                            <Tooltip 
                                label={`SPARX: ${sparxFormattedBalance} (${sparxUsdValue})`} 
                                placement="bottom"
                                hasArrow
                                bg="gray.800"
                            >
                                <HStack 
                                    py={1} 
                                    px={2} 
                                    borderRadius="md" 
                                    _hover={{ transform: 'translateY(-2px)', transition: 'transform 0.2s' }}
                                    transition="all 0.2s"
                                    bgGradient="linear(to-r, #FF6937, #FFA500)"
                                >
                                    <Image 
                                        src="/sparx-circle-logo.png" 
                                        boxSize="18px" 
                                        mr={1}
                                    />
                                    <Text fontSize="sm" fontWeight="bold" color="white">{sparxFormattedBalance}</Text>
                                </HStack>
                            </Tooltip>
                            
                            <Tooltip 
                                label={`XBURN: ${xburnFormattedBalance} (${xburnUsdValue})`} 
                                placement="bottom"
                                hasArrow
                                bg="gray.800"
                            >
                                <HStack 
                                    py={1} 
                                    px={2} 
                                    borderRadius="md" 
                                    _hover={{ transform: 'translateY(-2px)', transition: 'transform 0.2s' }}
                                    transition="all 0.2s"
                                    bgGradient="linear(to-r, #E53E3E, #FF6937)"
                                >
                                    <Image 
                                        src="/logo192.png" 
                                        boxSize="18px" 
                                        mr={1}
                                    />
                                    <Text fontSize="sm" fontWeight="bold" color="white">{xburnFormattedBalance}</Text>
                                </HStack>
                            </Tooltip>
                            
                            <Tooltip 
                                label={`ETH: ${ethFormattedBalance} (${ethUsdValue})`} 
                                placement="bottom"
                                hasArrow
                                bg="gray.800"
                            >
                                <HStack 
                                    py={1} 
                                    px={2} 
                                    borderRadius="md" 
                                    _hover={{ transform: 'translateY(-2px)', transition: 'transform 0.2s' }}
                                    transition="all 0.2s"
                                    bgGradient="linear(to-r, #3182CE, #63B3ED)"
                                >
                                    <Icon 
                                        as={FaEthereum} 
                                        color="white" 
                                        boxSize="16px" 
                                        mr={1}
                                    />
                                    <Text fontSize="sm" fontWeight="bold" color="white">{ethFormattedBalance}</Text>
                                </HStack>
                            </Tooltip>
                        </HStack>
                    )}

                    {/* Connect Button with Customized RainbowKit */}
                    <Box>
                        <ConnectButton.Custom>
                            {({
                                account,
                                chain,
                                openAccountModal,
                                openChainModal,
                                openConnectModal,
                                mounted,
                            }) => {
                                const ready = mounted;
                                const connected = ready && account && chain;
                                
                                return (
                                    <div
                                        {...(!ready && {
                                            'aria-hidden': true,
                                            style: {
                                                opacity: 0,
                                                pointerEvents: 'none',
                                                userSelect: 'none',
                                            },
                                        })}
                                    >
                                        {(() => {
                                            if (!connected) {
                                                return (
                                                    <Button 
                                                        onClick={openConnectModal} 
                                                        colorScheme="orange"
                                                        size="sm"
                                                    >
                                                        Connect Wallet
                                                    </Button>
                                                );
                                            }
                                            
                                            return (
                                                <HStack>
                                                    <Button
                                                        onClick={openChainModal}
                                                        size="sm"
                                                        variant="outline"
                                                        colorScheme="gray"
                                                        mr={2}
                                                    >
                                                        {chain.hasIcon && (
                                                            <Box
                                                                style={{
                                                                    background: chain.iconBackground,
                                                                    width: 16,
                                                                    height: 16,
                                                                    borderRadius: 999,
                                                                    overflow: 'hidden',
                                                                    marginRight: 4,
                                                                }}
                                                            >
                                                                {chain.iconUrl && (
                                                                    <img
                                                                        alt={chain.name ?? 'Chain icon'}
                                                                        src={chain.iconUrl}
                                                                        style={{ width: 16, height: 16 }}
                                                                    />
                                                                )}
                                                            </Box>
                                                        )}
                                                        {chain.name}
                                                    </Button>
                                                    
                                                    <Button
                                                        onClick={openAccountModal}
                                                        size="sm"
                                                        colorScheme="orange"
                                                    >
                                                        {account.displayName || truncateAddress(account.address)}
                                                    </Button>
                                                </HStack>
                                            );
                                        })()}
                                    </div>
                                );
                            }}
                        </ConnectButton.Custom>
                    </Box>
                </Flex>
            </Container>
        </Box>
    );
};

export default Header; 