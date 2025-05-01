// Define your contract addresses here for different networks
// Example structure:
// networkName: {
//   contract1: "address1",
//   contract2: "address2",
// }

export const contractAddresses = {
  mainnet: {
    burner: "",
    sparx: "",
    farm: "",
    LP_CBXEN_XBURN: "",
    LP_XBURN_WETH: "",
    LP_XBURN_SPARX: "",
    LP_SPARX_WETH: "",
    XEN: "",
    XBURN: "",
    UNISWAP_ROUTER: "",
    WETH: "",
  },
  sepolia: {
    burner: "0x2ABf35F38e865BC9e134F727a80dCB216164CA47",
    sparx: "0xE0c598695bb60d6bf10c0BC418aA4C0Ecb28063C",
    farm: "0xBD31F08c9f82Ded3F03C88e244433ea2bc3b0458",
    LP_XBURN_WETH: "0x201ac7834027A656718Ee620FE255d39647dE967",
    LP_XBURN_SPARX: "0x1D92e6bdC808DfEbfB5d829B40a0082ad1d80BC3",
    LP_SPARX_WETH: "0xdc73e6477882aa5d5d03F20A833FEA2815234835",
    LP_SPARX_CBXEN: "0xcDaDBCF1714bDf0522B8baD90968451268ECa1FE",
    LP_CBXEN_XBURN: "0x38C29A96f026F169822c3Dd150cCF9504260b5e6",
    xburn: "0x964db60EfdF9FDa55eA62f598Ea4c7a9cD48F189",
    router: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
    cbxen: "0x28b51ffFE4B11eA09F30fBC97b986Edc6B41d898",
  },
  // Add other networks like 'goerli', 'polygon', etc. as needed
} as const;

// Commented out block removed