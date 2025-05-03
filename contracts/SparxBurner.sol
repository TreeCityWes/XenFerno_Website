/**
 * @notice Deposits SPARX tokens into the contract
 * @param amount The amount of SPARX tokens to deposit
 */
function deposit(uint256 amount) external nonReentrant {
    if (amount == 0) revert SparxBurner__InsufficientAmountOut();
    
    IERC20(address(sparxToken)).safeTransferFrom(msg.sender, address(this), amount);
}

/**
 * @notice Deposits SPARX tokens and immediately ignites them
 * @param amount The amount of SPARX tokens to deposit
 * @param customSlippagePercentage Custom slippage tolerance or 0 to use default
 */
function depositAndIgnite(uint256 amount, uint256 customSlippagePercentage) external nonReentrant {
    if (amount == 0) revert SparxBurner__InsufficientAmountOut();
    if (amount < minimumIgniteAmount) revert SparxBurner__NothingToIgnite();
    
    // First transfer tokens from user to contract
    IERC20(address(sparxToken)).safeTransferFrom(msg.sender, address(this), amount);
    
    // Then call internal ignite function
    _ignite(customSlippagePercentage);
}

function _ignite(uint256 customSlippagePercentage) internal {
    // Validate slippage if provided
    if (customSlippagePercentage > 0 && (customSlippagePercentage > 100 || customSlippagePercentage < 10)) {
        revert SparxBurner__InvalidPercentage();
    }
    
    // Use custom slippage if provided, otherwise use contract default
    uint256 slippageToUse = customSlippagePercentage > 0 ? customSlippagePercentage : minAmountOutPercentage;
    
    uint256 initialBalance = sparxToken.balanceOf(address(this));
    if (initialBalance < minimumIgniteAmount) revert SparxBurner__NothingToIgnite();

    // 1. Calculate and send caller reward
    uint256 callerReward = (initialBalance * CALLER_REWARD_PERCENT) / PERCENTAGE_DENOMINATOR;
    if (callerReward > 0) {
         // safeTransfer will revert if the underlying transfer returns false
         IERC20(address(sparxToken)).safeTransfer(msg.sender, callerReward);
         emit RewardPaid(msg.sender, callerReward);
    }

    // 2. Calculate amounts for swap and burn (based on balance *after* reward)
    uint256 remainingBalance = sparxToken.balanceOf(address(this)); // Get actual balance after reward transfer
    if (remainingBalance == 0) revert SparxBurner__NothingToIgnite();
    
    uint256 amountToSwap = (remainingBalance * SWAP_PERCENTAGE) / PERCENTAGE_DENOMINATOR;
    uint256 amountToBurnSparx = remainingBalance - amountToSwap;
    
    // Ensure we have something left to swap/burn after reward
    if (amountToSwap == 0 && amountToBurnSparx == 0) revert SparxBurner__NothingToIgnite(); 
}

// --- Owner Functions --- 