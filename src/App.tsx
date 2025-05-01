import { useState } from 'react'
import { 
  Box, 
  Container,
  Flex,
  VStack,
  useColorModeValue,
  Image,
  Text,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel
} from '@chakra-ui/react'
import { useAccount } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import Header from './components/Header'
import Footer from './components/Footer'
import LiquidityTab from './features/Liquidity/LiquidityTab'
import FarmTab from './features/Farm/FarmTab'
import StakingTab from './features/Staking/StakingTab'
import BurnerTab from './features/Burner/BurnerTab'
import GlobalStatsBanner from './components/GlobalStatsBanner'

function App() {
  const bgColor = useColorModeValue('gray.50', 'gray.900')
  const textColor = useColorModeValue('gray.800', 'whiteAlpha.900')

  const [tabIndex, setTabIndex] = useState(0)

  const { chain } = useAccount()
  const isWrongNetwork = chain && chain.id !== sepolia.id

  return (
    <Flex direction="column" minH="100vh" bg={bgColor} color={textColor}>
      <Header />

      <Container maxW="container.lg" py={6} flexGrow={1}>
        {isWrongNetwork ? (
          <VStack spacing={4} align="center" justify="center" minH="50vh" bg="red.700" p={6} borderRadius="md">
            <Text fontSize="xl" fontWeight="bold" color="white">
              Incorrect Network
            </Text>
            <Text color="white">
              Please switch to the Sepolia network in your wallet to use this application.
            </Text>
          </VStack>
        ) : (
          <VStack spacing={6} align="stretch">
            <Image 
              src="/1500x500-socialmedia.png" 
              alt="Hero Image" 
              width="100%" 
              maxH="300px"
              objectFit="cover"
              mb={6}
            />
            <GlobalStatsBanner />
            
            <Tabs 
              index={tabIndex} 
              onChange={setTabIndex} 
              colorScheme="brand"
              variant="soft-rounded"
              isLazy
            >
              <TabList>
                <Tab>
                  Liquidity
                </Tab>
                <Tab>
                  Farm
                </Tab>
                <Tab>
                  Staking
                </Tab>
                <Tab>
                  Burner 
                </Tab>
              </TabList>
              <TabPanels mt={4}>
                <TabPanel px={0} pt={2}>
                  <LiquidityTab isActive={tabIndex === 0} />
                </TabPanel>
                <TabPanel px={0} pt={2}>
                  <FarmTab isActive={tabIndex === 1} />
                </TabPanel>
                <TabPanel px={0} pt={2}>
                  <StakingTab isActive={tabIndex === 2} />
                </TabPanel>
                <TabPanel px={0} pt={2}>
                  <BurnerTab isActive={tabIndex === 3} /> 
                </TabPanel>
              </TabPanels>
            </Tabs>
          </VStack>
        )}
      </Container>

      <Footer />
    </Flex>
  )
}

export default App
