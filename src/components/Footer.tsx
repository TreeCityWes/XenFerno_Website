import { Box, Text, Link, HStack, Spacer, Container, useColorModeValue, Flex, Icon } from '@chakra-ui/react';
import { FaTwitter, FaTelegramPlane, FaGlobe, FaGithub } from 'react-icons/fa';

function Footer() {
    const bgColor = 'gray.800'; // Always dark footer to match theme
    const textColor = 'gray.400';
    const borderColor = 'gray.700';
    const hoverColor = '#FF6937'; // Fire orange to match branding

    return (
        <Box 
            bg={bgColor} 
            color={textColor} 
            mt={16}
            borderTopWidth="1px"
            borderColor={borderColor}
        > 
            <Container maxW="container.xl" py={6}> 
                <Flex direction={{ base: 'column', md: 'row' }} align="center">
                    <Text fontSize="sm">
                        &copy; {new Date().getFullYear()} XenFerno Farms. All rights reserved.
                    </Text>
                    <Spacer />
                    <HStack spacing={6} mt={{ base: 4, md: 0 }}>
                        <Link 
                            href="https://burnxen.com" 
                            isExternal 
                            title="Website" 
                            _hover={{ color: hoverColor }}
                            transition="transform 0.2s, color 0.2s"
                        >
                            <Icon 
                                as={FaGlobe} 
                                boxSize="20px" 
                                _hover={{ transform: 'scale(1.2)' }}
                                transition="transform 0.2s"
                            />
                        </Link>
                        <Link 
                            href="https://x.com/BurnMoreXen" 
                            isExternal 
                            title="Twitter"
                            _hover={{ color: hoverColor }}
                            transition="transform 0.2s, color 0.2s"
                        >
                            <Icon 
                                as={FaTwitter} 
                                boxSize="20px" 
                                _hover={{ transform: 'scale(1.2)' }}
                                transition="transform 0.2s"
                            />
                        </Link>
                        <Link 
                            href="https://t.me/BurnMoreXen" 
                            isExternal 
                            title="Telegram"
                            _hover={{ color: hoverColor }}
                            transition="transform 0.2s, color 0.2s"
                        >
                            <Icon 
                                as={FaTelegramPlane} 
                                boxSize="20px" 
                                _hover={{ transform: 'scale(1.2)' }}
                                transition="transform 0.2s"
                            />
                        </Link>
                        <Link 
                            href="https://github.com/burnxen" 
                            isExternal 
                            title="GitHub"
                            _hover={{ color: hoverColor }}
                            transition="transform 0.2s, color 0.2s"
                        >
                            <Icon 
                                as={FaGithub} 
                                boxSize="20px" 
                                _hover={{ transform: 'scale(1.2)' }}
                                transition="transform 0.2s"
                            />
                        </Link>
                    </HStack>
                </Flex>
            </Container>
        </Box>
    );
}

export default Footer; 