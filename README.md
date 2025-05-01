# Frontend Integration Guide for Sparx/XBurn Farms (Sepolia Deployment)

This document provides guidance for frontend developers integrating with the Sparx/XBurn Farms smart contracts deployed on the **Sepolia testnet**.
Updated Contract Addresses

Sparx Token: 0x8c1976E361eaF6523d414e20De427e4142A431a5

Sparx Burner: 0x4a1Fe998D084465eD932c52E12aBd9A3b061DadA

Sparx FarmV2: 0xdB36e0c2d990c4C9b68267Fed83d71c72d51E568

XBURN Token: 0x964db60EfdF9FDa55eA62f598Ea4c7a9cD48F189

Router: 0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3

LP Token Addresses

CBXEN/XBURN: 0x38C29A96f026F169822c3Dd150cCF9504260b5e6

XBURN/WETH: 0x201ac7834027A656718Ee620FE255d39647dE967

XBURN/SPARX: 0xA155228C85165Eb8ed60CF662Ce9E1a109B7F17e

SPARX/WETH: 0xB5471492948f1a9e97D442EDcbF7f938C5755f62

SPARX/CBXEN: 0x28b51ffFE4B11eA09F30fBC97b986Edc6B41d898

Frontend Implementation Priorities

1. Dashboard Overview

Token Metrics: Total Supply, Circulating Supply, Market Cap, Volume, Fee Structure (1% dev, 2% burner).

Burn Metrics: Real-time burn rate, historical burns, total burned visualization.

2. User Wallet Integration

Balance Check: balanceOf(address)

Fee Exemption Check: isFeeExempt(address)

Transfer Interface: Integrate fee calculation preview (getFeeStructure())

3. Farming Interface

Pool Details: poolInfo(pid), getPoolDistributionInfo(), current APY/APR calculation.

User Position: userInfo(pid, address), pending rewards (pendingRewards(pid, address)), cooldown (userCooldownInfo(pid, address)).

Emission Schedule: Real-time emission rate (currentRate()), detailed phase breakdown (getEmissionPhaseInfo()).
## 1. Contract Addresses & Source of Truth

The **single source of truth** for all deployed contract addresses, LP pair addresses, and key transaction hashes for the current environment (Sepolia) is the `addresses.json` file located in the project root.

**DO NOT** hardcode addresses in the frontend codebase.

### `addresses.json` Structure:

```json
{
  "burner": "0x...", // Address of the SparxBurner contract
  "sparx": "0x...", // Address of the SparxToken (SPARX) contract
  "farm": "0x...", // Address of the SparxFarmV2 contract
  "LP_CBXEN_XBURN": "0x...", // Address of Uniswap V2 LP Pair: CBXEN/XBURN
  "LP_XBURN_WETH": "0x...", // Address of Uniswap V2 LP Pair: XBURN/WETH
  "LP_XBURN_SPARX": "0x...", // Address of Uniswap V2 LP Pair: XBURN/SPARX
  "LP_SPARX_WETH": "0x...", // Address of Uniswap V2 LP Pair: SPARX/WETH
  "LP_SPARX_CBXEN": "0x...", // Address of Uniswap V2 LP Pair: SPARX/CBXEN
  "router": "0x...", // Address of the Uniswap V2 Router used
  "xburn": "0x...", // Address of the XBURN token used
  "burnerDeployTxHash": "0x...", // Tx hash for SparxBurner deployment
  "sparxDeployTxHash": "0x...", // Tx hash for SparxToken deployment
  "farmDeployTxHash": "0x...", // Tx hash for SparxFarmV2 deployment
  "LP_XBURN_SPARX_CreateTxHash": "0x...", // Tx hash for XBURN/SPARX LP creation (if created)
  "LP_SPARX_WETH_CreateTxHash": "0x...", // Tx hash for SPARX/WETH LP creation (if created)
  "LP_SPARX_CBXEN_CreateTxHash": "0x..." // Tx hash for SPARX/CBXEN LP creation (if created)
  // Note: LP Create hashes only appear if the script newly created the pair.
}
```

*(Replace `0x...` with the actual values from the file)*

### Integration Plan:

1.  **Loading:** Load `addresses.json` during the build process. Make the addresses available as constants or via an environment configuration module (e.g., `src/config/contracts.ts`).
2.  **Access:** Create a central configuration module or context (e.g., `src/contexts/ContractContext.tsx`) to export these addresses and potentially initialized contract instances using ethers.js/viem/wagmi.
3.  **Environment:** Design the loading mechanism to potentially handle different address files per environment (e.g., `addresses.sepolia.json`, `addresses.mainnet.json`) in the future.

## 2. SparxFarmV2 Configuration (Staking Pools)

The `SparxFarmV2` contract (`farm` address in `addresses.json`) manages staking pools where users can deposit LP tokens or SPARX to earn SPARX rewards.

The currently configured pools on Sepolia are:

| Pool Name        | Staking Token             | Token Address (Key in `addresses.json`) | Allocation Points | Reward Share | Pool ID (pid) |
| :--------------- | :------------------------ | :-------------------------------------- | :---------------- | :----------- | :------------ |
| SPARX/WETH LP    | Uniswap V2 LP             | `LP_SPARX_WETH`                         | 3250              | 32.5%        | 0             |
| XBURN/WETH LP    | Uniswap V2 LP             | `LP_XBURN_WETH`                         | 3250              | 32.5%        | 1             |
| SPARX/XBURN LP   | Uniswap V2 LP             | `LP_XBURN_SPARX`                        | 1500              | 15.0%        | 2             |
| SPARX/CBXEN LP   | Uniswap V2 LP             | `LP_SPARX_CBXEN`                        | 1500              | 15.0%        | 3             |
| Single-Sided SPARX | SPARX Token               | `sparx`                                 | 500               | 5.0%         | 4             |
| **Total**        |                           |                                         | **10000**         | **100.0%**   |               |

**Key Frontend Considerations:**

*   Fetch pool information dynamically from the `SparxFarmV2` contract using functions like `poolLength()`, `poolInfo(pid)`, `totalAllocPoint()`, `pendingRewards(pid, userAddress)`.
*   Display the correct staking token name and potentially link to the LP pair on Uniswap/explorer using the addresses from `addresses.json`.
*   Calculate and display APR/APY based on current emission rates (`currentRate()` on farm contract) and pool data.
*   Implement UI for deposit, withdraw, and harvest actions, calling the corresponding functions (`deposit(pid, amount)`, `withdraw(pid, amount)`, `harvest(pid)`) on the farm contract.
*   Handle token approvals (ERC20 `approve`) for the specific staking token address before allowing deposits.
*   Display user-specific info: staked amount, pending rewards (`userInfo(pid, userAddress)`, `pendingRewards(pid, userAddress)`).
*   Consider displaying cooldown information (`userCooldownInfo(pid, userAddress)`).

## 3. SPARX Token (Fee-on-Transfer)

The `SparxToken` (`sparx` address in `addresses.json`) has a **3% fee on transfers** between non-exempt addresses (1% to Dev Treasury, 2% to Burner Vault).

**Key Frontend Considerations:**

*   **Displaying Balances:** Standard ERC20 `balanceOf` calls work as expected.
*   **Transfers:** When initiating standard ERC20 transfers via the frontend, inform the user about the 3% fee if the recipient is likely a regular EOA (Externally Owned Account). Transfers to/from core contracts (Farm, Burner, LPs listed in `addresses.json`) and the Dev wallet *should* be fee-exempt based on backend configuration.
*   **Swaps (Uniswap):** Users interacting via the standard Uniswap frontend/router should not experience the SPARX fee directly during the swap itself, as the Router and relevant LP pairs are fee-exempt. However, the underlying price impact reflects the token's nature. When displaying SPARX price/value, be mindful that the effective value received after a sale might be lower due to fees if the buyer/seller isn't exempt.
*   **Farming Interactions:** Deposits/Withdrawals/Harvests involving the `SparxFarmV2` contract (`farm` address) should *not* incur the SPARX transfer fee due to the farm contract being fee-exempt.

## 4. SparxBurner (Ignite Function)

The `SparxBurner` contract (`burner` address) accumulates SPARX fees. Anyone can call the `ignite()` function.

**Key Frontend Considerations:**

*   Display the current SPARX balance of the `SparxBurner` contract.
*   Provide a button or mechanism for users to trigger the `ignite()` function.
*   Explain the `ignite()` process to the user: 5% caller reward (in SPARX), 50% of remaining SPARX swapped for XBURN (and burned), 50% of remaining SPARX burned directly.
*   Display historical `TokensIgnited` events if relevant.

## 5. General Implementation Notes

*   **ABIs:** Ensure you have the latest ABIs for `SparxToken`, `SparxFarmV2`, and `SparxBurner` available in the frontend for contract interaction.
*   **Error Handling:** Implement robust error handling for transaction reverts, insufficient approvals, gas estimation failures, and contract interaction errors. Decode contract-specific errors where possible for better user feedback.
*   **User Experience:** Clearly communicate fees, cooldowns, and staking mechanics to the user.
*   **Wallet Integration:** Use standard libraries (wagmi, ethers.js, viem) for wallet connection and transaction signing.
*   **Sepolia Network:** Ensure the frontend is configured to connect to the Sepolia testnet by default. Prompt users to switch networks if they are connected to a different one.

---

This guide should provide the necessary context to update the frontend. Refer to the contract source code and the `addresses.json` file for definitive details. 