import { extendTheme, ThemeConfig, theme as baseTheme } from '@chakra-ui/react'

const config: ThemeConfig = {
  initialColorMode: 'dark',
  useSystemColorMode: false,
}

const colors = {
  brand: { // Yellow-Orange from sparxColor
    50: '#FFF8E1', // Lightest yellow
    100: '#FFECB3',
    200: '#FFE082',
    300: '#FFD54F',
    400: '#FFCA28',
    500: '#FFA500', // Main accent color (#FFA500)
    600: '#FF8F00', // Darker shade
    700: '#FF6F00',
    800: '#FF4F00',
    900: '#FF3D00',
  },
  red: { // Keep a distinct red for actions
    ...baseTheme.colors.red,
    500: '#FF3A2F', // Bright red
    600: '#E62E2A', // Darker hover
  },
  accent: { // Purple
    50: '#FAF5FF',
    100: '#E9D8FD',
    200: '#D6BCFA',
    300: '#B794F4',
    400: '#9F7AEA', // Secondary accent
    500: '#805AD5',
    600: '#6B46C1',
    700: '#553C9A',
    800: '#44337A',
    900: '#322659',
  },
  gray: {
    ...baseTheme.colors.gray,
    700: '#2D3748', 
    800: '#1A202C', 
    900: '#171923', 
  },
  // Keep yellow as a secondary accent if needed, e.g., for pending rewards
  yellow: {
    ...baseTheme.colors.yellow,
    400: '#ECC94B',
  },
}

const burnTheme = extendTheme({
  config,
  colors,
  styles: {
    global: (props: any) => ({
      body: {
        bg: props.colorMode === 'dark' ? 'gray.900' : 'gray.50',
        color: props.colorMode === 'dark' ? 'whiteAlpha.900' : 'gray.800',
        lineHeight: 'base',
      },
    }),
  },
  components: {
    Button: {
      baseStyle: {
        fontWeight: 'semibold',
        borderRadius: 'lg',
      },
      variants: {
        solid: (props: any) => ({
          // Use brand.500 (#FFA500) for brand color scheme buttons
          bg: props.colorScheme === 'brand' ? 'brand.500' : `${props.colorScheme}.500`,
          // Use black text on this yellow-orange for better contrast
          color: props.colorScheme === 'brand' ? 'black' : 'white',
          _hover: {
             // Use brand.600 for hover
            bg: props.colorScheme === 'brand' ? 'brand.600' : `${props.colorScheme}.600`,
            _disabled: {
              bg: props.colorScheme === 'brand' ? 'brand.500' : `${props.colorScheme}.500`,
            }
          },
        }),
        outline: (props: any) => ({ // Keep outline potentially different if needed
          borderColor: props.colorScheme === 'accent' ? 'accent.400' : `${props.colorScheme}.400`,
          color: props.colorScheme === 'accent' ? 'accent.300' : `${props.colorScheme}.300`,
           _hover: {
            bg: props.colorMode === 'dark' ? 'whiteAlpha.100' : 'blackAlpha.100',
          },
        }),
      },
    },
    Tabs: {
      baseStyle: {
        tab: {
          fontWeight: 'semibold',
        },
      },
      variants: {
        "soft-rounded": (props: any) => { 
          return {
            tab: {
              borderRadius: "md",
              flex: 1,
              bg: "gray.800", 
              color: "gray.400", 
              _hover: { 
                bg: "gray.700",
                color: "whiteAlpha.900"
               },
              _selected: {
                // Use brand.500 (#FFA500) for selected tab background
                bg: props.colorScheme === 'brand' ? 'brand.500' : `${props.colorScheme}.500`,
                 // Use black text for contrast
                color: props.colorScheme === 'brand' ? 'black' : 'white',
              },
            },
            tablist: {
                bg: "gray.800", 
                borderRadius: "md",
                p: 1,
            },
          };
        },
      },
    },
    // Add other component styles if needed
  },
})

export default burnTheme 