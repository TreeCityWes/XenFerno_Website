export interface LiquidityPool {
  name: string
  address: `0x${string}` // Ensure address is typed correctly
  token1: string
  token2: string
  pid: number // Add Pool ID
  apr: number | null
  userShare: number | null // Represents percentage
  reserve0Raw: bigint | null // Raw bigint reserves
  reserve1Raw: bigint | null // Raw bigint reserves
  token0Address: `0x${string}` | null
  token1Address: `0x${string}` | null
  // New fields for balances and allowances
  userLpBalance: bigint | null
  userToken1Balance: bigint | null
  userToken2Balance: bigint | null
  token1Allowance: bigint | null // Allowance for Router
  token2Allowance: bigint | null // Allowance for Router
  lpTokenAllowance: bigint | null // Allowance for Router
} 