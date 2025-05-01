import { Box, Text, Link, HStack, Spacer, Container, useColorModeValue, Flex } from '@chakra-ui/react';
import { FaTwitter, FaTelegramPlane, FaGlobe } from 'react-icons/fa'; // Example icons

function Footer() {
    const bgColor = useColorModeValue('gray.800', 'gray.800'); // Consistent dark footer
    const textColor = useColorModeValue('gray.400', 'gray.400');
    const iconColor = useColorModeValue('gray.500', 'gray.500');
    const hoverColor = useColorModeValue('orange.400', 'orange.400');

    return (
        <Box bg={bgColor} color={textColor} mt={16}> {/* Add margin top */} 
            <Container maxW="container.xl" py={6}> 
                <Flex direction={{ base: 'column', md: 'row' }} align="center">
                    <Text fontSize="sm">
                        &copy; {new Date().getFullYear()} XenFerno Farms. All rights reserved.
                    </Text>
                    <Spacer />
                    <HStack spacing={4} mt={{ base: 4, md: 0 }}>
                        <Link href="https://burnxen.com" isExternal title="Website" _hover={{ color: hoverColor }}>
                            <FaGlobe size="20px" color={iconColor} />
                        </Link>
                        <Link href="https://x.com/burnmorexen" isExternal title="Twitter" _hover={{ color: hoverColor }}>
                            <FaTwitter size="20px" color={iconColor} />
                        </Link>
                        <Link href="https://t.me/burnmorexen" isExternal title="Telegram" _hover={{ color: hoverColor }}>
                             <FaTelegramPlane size="20px" color={iconColor} />
                        </Link>
                        {/* Add more links as needed */}
                    </HStack>
                </Flex>
            </Container>
        </Box>
    );
}

export default Footer; 