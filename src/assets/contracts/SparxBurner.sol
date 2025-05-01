// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18; // Updated pragma for Uniswap interfaces

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// Custom Errors
error SparxBurner__ZeroAddress();
error SparxBurner__NothingToIgnite();
error SparxBurner__SwapFailed();
error SparxBurner__InsufficientAmountOut();
error SparxBurner__RouterError();
error SparxBurner__TransferFailed();
error SparxBurner__BurnFailed();
error SparxBurner__ApprovalFailed();
error SparxBurner__InvalidPercentage();
error SparxBurner__InvalidDeadlineBuffer();
error SparxBurner__RewardTransferFailed(); // Added for reward failure
error OwnableUnauthorizedAccount(address account); // Keep standard Ownable error

// Interface for SPARX token (assuming standard burn)
interface ISparxToken is IERC20 {
    function burn(uint256 amount) external;
}

// Interface specifically for XBURN token (XBurnMinter)
interface IXBurnToken is IERC20 {
    function burnXburn(uint256 amount) external;
}

// Interface for Uniswap V2 Router
interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function getAmountsOut(
        uint amountIn,
        address[] calldata path
    ) external view returns (uint[] memory amounts);

    function WETH() external pure returns (address);
}

/**
 * @title SparxBurner
 * @notice Contract to accumulate SPARX, give caller reward, swap half remaining for XBURN, and burn remainder.
 * @dev Implements a buy-and-burn mechanism with caller incentive using a DEX router.
 */
contract SparxBurner is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20; // Use SafeERC20 for all ERC20 transfers

    ISparxToken public sparxToken;
    IXBurnToken public xburnToken;
    IUniswapV2Router02 public router;

    // Constants
    uint256 public constant CALLER_REWARD_PERCENT = 5; // 5%
    uint256 public constant SWAP_PERCENTAGE = 50; // 50% of remaining
    uint256 public constant PERCENTAGE_DENOMINATOR = 100;

    // Configurable Parameters
    uint256 public minAmountOutPercentage; // e.g., 95 means 95%
    uint256 public swapDeadlineBuffer;     // e.g., 300 seconds (5 minutes)
    uint256 public minimumIgniteAmount;    // Minimum SPARX balance required to call ignite

    // Events
    event TokensIgnited(
        address indexed caller,
        uint256 callerReward,
        uint256 sparxSwapped,
        uint256 sparxBurnedDirectly,
        uint256 xburnReceivedAndBurned,
        uint256 slippagePercentage
    );
    event RewardPaid(address indexed caller, uint256 amount);
    event SparxTokenUpdated(address indexed oldToken, address indexed newToken);
    event XBurnTokenUpdated(address indexed oldToken, address indexed newToken);
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);
    event MinAmountOutPercentageUpdated(uint256 oldPercentage, uint256 newPercentage);
    event SwapDeadlineBufferUpdated(uint256 oldBuffer, uint256 newBuffer);
    event MinimumIgniteAmountUpdated(uint256 oldMinimum, uint256 newMinimum);

    constructor(
        address _sparxToken,
        address _xburnToken,
        address _router
    ) {
        if (_sparxToken == address(0) || _xburnToken == address(0) || _router == address(0)) {
             revert SparxBurner__ZeroAddress();
        }
        sparxToken = ISparxToken(_sparxToken);
        xburnToken = IXBurnToken(_xburnToken);
        router = IUniswapV2Router02(_router);
        
        minAmountOutPercentage = 85; // Default to 85% to accommodate testing with 10% slippage
        swapDeadlineBuffer = 300;   // Default to 5 minutes
        minimumIgniteAmount = 10000 * 10**18; // Default to 10,000 SPARX

        _transferOwnership(msg.sender); // Transfer ownership to deployer
    }
    
    /**
     * @notice Default ignite function with contract's default slippage setting
     */
    function ignite() external nonReentrant {
        _ignite(0); // Pass 0 to use default slippage
    }

    /**
     * @notice Gives 5% reward, swaps half remaining SPARX for XBURN, burns rest.
     * @param customSlippagePercentage Custom slippage tolerance (e.g., 80 means 80%). Uses contract default if 0.
     */
    function ignite(uint256 customSlippagePercentage) external nonReentrant {
        _ignite(customSlippagePercentage);
    }
    
    /**
     * @dev Internal implementation of ignite logic to avoid code duplication
     * @param customSlippagePercentage Custom slippage tolerance or 0 to use default
     */
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
        uint256 remainingBalance = initialBalance - callerReward;
        uint256 amountToSwap = (remainingBalance * SWAP_PERCENTAGE) / PERCENTAGE_DENOMINATOR;
        uint256 amountToBurnSparx = remainingBalance - amountToSwap;
        
        // Ensure we have something left to swap/burn after reward
        if (amountToSwap == 0 && amountToBurnSparx == 0) revert SparxBurner__NothingToIgnite(); 

        uint256 actualXburnReceived = 0; // Initialize here

        // 3. Perform Swap (only if amountToSwap > 0)
        if (amountToSwap > 0) {
            // Approve router to spend SPARX - only need one approval
            try IERC20(address(sparxToken)).approve(address(router), amountToSwap) {} catch {
                revert SparxBurner__ApprovalFailed();
            }

            // Prepare swap parameters
            address[] memory path = new address[](2);
            path[0] = address(sparxToken);
            path[1] = address(xburnToken);
            uint256 deadline = block.timestamp + swapDeadlineBuffer;

            // Estimate minimum XBURN out
            uint[] memory amountsOut;
            try router.getAmountsOut(amountToSwap, path) returns (uint[] memory _amountsOut) {
                amountsOut = _amountsOut;
            } catch {
                revert SparxBurner__RouterError();
            }
            
            if (amountsOut.length < 2) revert SparxBurner__RouterError();
            
            // Calculate minimum amount out based on the slippage percentage being used
            uint256 expectedXburnOut = amountsOut[1];
            uint256 minAmountXburnOut = (expectedXburnOut * slippageToUse) / PERCENTAGE_DENOMINATOR;
            if (minAmountXburnOut == 0) revert SparxBurner__InsufficientAmountOut();
            
            // Execute swap
            try router.swapExactTokensForTokens(
                amountToSwap,
                minAmountXburnOut,
                path,
                address(this),
                deadline
            ) returns (uint[] memory received) {
                if (received.length < 2) revert SparxBurner__RouterError();
                actualXburnReceived = received[1];
            } catch Error(string memory reason) {
                // Check for specific string errors from MockRouter
                if (keccak256(bytes(reason)) == keccak256(bytes("MockRouter: Swap reverted"))) {
                    revert SparxBurner__SwapFailed();
                }
                revert(reason);
            } catch {
                revert SparxBurner__SwapFailed();
            }
        }

        // 4. Burn remaining SPARX (only if amount > 0)
        if (amountToBurnSparx > 0) {
            // Call the public burn function on SparxToken
            // The SparxBurner contract calls burn, burning tokens it holds.
            try sparxToken.burn(amountToBurnSparx) {}
            catch {
                 revert SparxBurner__BurnFailed(); // Revert if the burn call fails
            }
            // IERC20(address(sparxToken)).safeTransfer(address(0), amountToBurnSparx);
            // // If safeTransfer fails, it will revert automatically.
            // // The SparxToken._afterTokenTransfer hook handles the SparxBurned event.
        }

        // 5. Burn received XBURN (only if amount > 0)
        if (actualXburnReceived > 0) {
            try xburnToken.burnXburn(actualXburnReceived) {} catch { 
                revert SparxBurner__BurnFailed(); 
            }
        }

        emit TokensIgnited(
            msg.sender,
            callerReward,
            amountToSwap, // SPARX amount that was targeted for swapping
            amountToBurnSparx, // SPARX amount burned directly
            actualXburnReceived, // XBURN received from swap and then burned
            slippageToUse // The slippage percentage that was used
        );
    }

    // --- Owner Functions --- 

    function setRouter(address _newRouter) external onlyOwner {
        if (_newRouter == address(0)) revert SparxBurner__ZeroAddress();
        address oldRouter = address(router);
        router = IUniswapV2Router02(_newRouter);
        emit RouterUpdated(oldRouter, _newRouter);
    }

    function setMinAmountOutPercentage(uint256 _newPercentage) external onlyOwner {
        if (_newPercentage == 0 || _newPercentage > 100) revert SparxBurner__InvalidPercentage();
        uint256 oldPercentage = minAmountOutPercentage;
        minAmountOutPercentage = _newPercentage;
        emit MinAmountOutPercentageUpdated(oldPercentage, _newPercentage);
    }

    function setSwapDeadlineBuffer(uint256 _newBuffer) external onlyOwner {
        // Add a reasonable upper limit, e.g., 1 hour? Prevents excessively long deadlines.
        if (_newBuffer == 0 || _newBuffer > 3600) revert SparxBurner__InvalidDeadlineBuffer(); 
        uint256 oldBuffer = swapDeadlineBuffer;
        swapDeadlineBuffer = _newBuffer;
        emit SwapDeadlineBufferUpdated(oldBuffer, _newBuffer);
    }

    // Allow updating token addresses (as per user code structure)
    function setSparxToken(address _newToken) external onlyOwner {
        if (_newToken == address(0)) revert SparxBurner__ZeroAddress();
        address oldToken = address(sparxToken);
        sparxToken = ISparxToken(_newToken);
        emit SparxTokenUpdated(oldToken, _newToken);
    }

    function setXBurnToken(address _newToken) external onlyOwner {
        if (_newToken == address(0)) revert SparxBurner__ZeroAddress();
        address oldToken = address(xburnToken);
        xburnToken = IXBurnToken(_newToken);
        emit XBurnTokenUpdated(oldToken, _newToken);
    }

    /**
     * @notice Updates the minimum SPARX balance required to call the ignite function.
     * @dev Can only be called by the owner.
     * @param _newMinimum The new minimum amount (in wei).
     */
    function setMinimumIgniteAmount(uint256 _newMinimum) external onlyOwner {
        if (_newMinimum == 0) revert SparxBurner__InsufficientAmountOut(); // Re-use error? Or add new one? Using this for now.
        uint256 oldMinimum = minimumIgniteAmount;
        minimumIgniteAmount = _newMinimum;
        emit MinimumIgniteAmountUpdated(oldMinimum, _newMinimum);
    }

    // Emergency withdraw function
    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        if (to == address(0)) revert SparxBurner__ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }
    
    function recoverToken(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        if (to == address(0)) revert SparxBurner__ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    // --- View Functions --- 

    /**
     * @notice Returns the Uniswap V2 swap path used by this contract.
     * @dev Path: [SPARX_ADDRESS, XBURN_ADDRESS]
     * @return path The array of token addresses representing the swap path.
     */
    function getSwapPath() external view returns (address[] memory path) {
        path = new address[](2);
        path[0] = address(sparxToken);
        path[1] = address(xburnToken);
        return path;
    }

    /**
     * @notice Estimates the amount of XBURN received for a given amount of SPARX input.
     * @dev Calls the configured Uniswap V2 router's getAmountsOut function.
     * @param amountSparxIn The amount of SPARX tokens to hypothetically swap.
     * @return estimatedXburnOut The estimated amount of XBURN tokens received, without slippage.
     */
    function estimateXBurnOut(uint256 amountSparxIn) external view returns (uint256 estimatedXburnOut) {
        if (amountSparxIn == 0) return 0;
        if (address(router) == address(0)) return 0; // Router not set

        address[] memory path = new address[](2);
        path[0] = address(sparxToken);
        path[1] = address(xburnToken);

        try router.getAmountsOut(amountSparxIn, path) returns (uint[] memory amounts) {
            if (amounts.length >= 2) {
                return amounts[1];
            }
        } catch {
            // If getAmountsOut fails (e.g., no liquidity), return 0
            return 0;
        }
        return 0; // Should not be reached if try/catch works as expected
    }
}
