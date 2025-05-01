import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { ChakraProvider } from '@chakra-ui/react';
import burnTheme from './theme/burnTheme';

// Import wagmi v2 config component
import { WagmiConfig } from 'wagmi'; 

// Import RainbowKit CSS and Provider
import '@rainbow-me/rainbowkit/styles.css';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';

// Import the config from our new file
import { config } from './config/wagmi'; // Correct path

// Import React Query
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Create a client
const queryClient = new QueryClient();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <WagmiConfig config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <ChakraProvider theme={burnTheme}>
            <App />
          </ChakraProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiConfig>

    {/* The modal is created in wagmi.ts, no separate component needed */}
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
