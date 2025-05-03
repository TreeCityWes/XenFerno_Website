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
    burner: "0xbAB6a47ef49dEd68c529948826e23b009D2F41A4",
    sparx: "0x85771e17a3D43709651419e8c6666BA85B2Fb76D",
    farm: "0x4F508Ad8bE854C577008E562aA6b664a67824634",
    LP_CBXEN_XBURN: "0x38C29A96f026F169822c3Dd150cCF9504260b5e6",
    LP_XBURN_WETH: "0x201ac7834027A656718Ee620FE255d39647dE967",
    LP_XBURN_SPARX: "0xfCf4C4687f3B93bFf56133ea59CFD4e274421AC5",
    LP_SPARX_WETH: "0xbcD27099bA5263795f408EbE38354a7b48175219",
    LP_SPARX_CBXEN: "0x4De01C1c1089b82DA25AFe416945a1DE180AE3F0",
    xburn: "0x964db60EfdF9FDa55eA62f598Ea4c7a9cD48F189",
    router: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
    cbxen: "0xcAe27BE52c003953f0B050ab6a31E5d5F0d52ccB",
    sparxPlaceholder: "0x0000000000000000000000000000000000000001",
    needsSparxUpdate: "false",
  },
  // Add other networks like 'goerli', 'polygon', etc. as needed
} as const;

// Commented out block removed