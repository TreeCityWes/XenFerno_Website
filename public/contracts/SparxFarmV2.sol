// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title SparxFarmV2
 * @notice Farm for staking Uniswap V2 LP tokens to earn SPARX rewards
 * @dev Uses MasterChef-Lite style calculations with future migration capability
 *
 * UPGRADE / MIGRATION STRATEGY
 *  - futureFarm:   address of the contract that will mint after this one
 *  - depositsEnabled: can be toggled when futureFarm is announced
 *  - SparxToken cap enforcement lives in the SparxToken mint() function
 *  - Emergency functions allow pausing and contract migration
 *  - Anti-flash-loan protections prevent same-block reward extraction
 */

// Interface for SparxToken to call view functions (avoid full import)
interface ISparxToken is IERC20 {
    function mint(address account, uint256 amount) external;
    function CAP() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
    function isFeeExempt(address account) external view returns (bool);
}

// Custom Errors
error SparxFarmV2__ZeroAddress();
error SparxFarmV2__MaxPoolsReached();
error SparxFarmV2__InvalidPhase();
error SparxFarmV2__RateTooHigh();
error SparxFarmV2__InsufficientBalance();
error SparxFarmV2__MigrationAlreadySet();
error SparxFarmV2__EmissionsCapReached();
error SparxFarmV2__DepositsClosed();
error SparxFarmV2__DepositsDisabled();
error SparxFarmV2__FutureFarmNotSet();
error SparxFarmV2__Paused();
error SparxFarmV2__FlashActionPrevented();
error SparxFarmV2__CooldownActive();
error SparxFarmV2__NothingToHarvest();
error SparxFarmV2__InvalidEmissionSchedule();
error SparxFarmV2__PoolSupplyOverflow();
error SparxFarmV2__InvalidAllocPoint();
error SparxFarmV2__InvalidPid();
error SparxFarmV2__RewardTransferFailed();
error SparxFarmV2__TransferFailed();
error InvalidPhase();
error InvalidEmissionSchedule();
error InvalidPoolLength();
error InvalidRewardToken();
error InvalidStartBlock();
error InvalidEndBlock();
error InvalidRewardPerBlock();
error InvalidAllocPoint();
error InvalidPid();
error InvalidAmount();
error EmergencyWithdrawalNotAllowed();
error ContractMustBePaused();
error MigrationNotAllowed();
error InvalidAddress();
error SparxFarmV2__TokenNotAllowed();
error SparxFarmV2__TokenAlreadyAllowed();
error SparxFarmV2__TokenNotAllowedToRemove();
error SparxFarmV2__PoolAlreadyExists();
error SparxFarmV2__StakeLocked();

contract SparxFarmV2 is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using SafeERC20 for ISparxToken;
    using Math for uint256;

    /* ----------------------------------------------------- */
    /* -----------------   CONFIG CONSTANTS   -------------- */
    /* ----------------------------------------------------- */

    string public constant FARM_VERSION = "SparxFarmV2";
    uint256 public constant ACC_PRECISION = 1e12;
    uint256 public constant MAX_POOLS = 20;
    uint256 public constant MAX_RATE = 30 ether;          // match V3
    uint256 public constant EMISSIONS_CAP = 900_000_000 ether; // match V3
    uint256 public constant MAX_REWARD_PER_UPDATE = 1000 ether; // Maximum reward per pool update
    uint256 public constant MAX_ALLOC_POINTS = 10000;     // Maximum allocation points per pool
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant DEV_SHARE_DENOMINATOR = 100;  // Dev share percentage denominator
    
    // Anti-flash-loan constants
    // MIN_STAKE_BLOCKS must be >= 2 to ensure at least one full block passes
    uint256 public constant MIN_STAKE_BLOCKS = 3;   // Increased to 3 blocks for better security
    uint256 public constant COOLDOWN = 1 hours;     // Cooldown between actions
    uint256 public constant WITHDRAW_COOLDOWN = 30 minutes; // Shorter cooldown for withdrawals
    uint256 public constant MAX_ACTIONS_PER_BLOCK = 1; // Maximum actions per block per user
    uint256 public constant YEAR = 365 * 86400; // Seconds in a year
    
    // Testing helpers (to make tests work) - Removed as testMode is no longer needed
    // bool public testMode = false; // Default to false for production safety - Removed

    /* ----------------------------------------------------- */
    /* -----------------      STORAGE       ---------------- */
    /* ----------------------------------------------------- */

    struct PoolInfo {
        IERC20  lp;                     // Token being staked (LP or SPARX)
        uint256 allocPoint;             // allocation weight
        uint256 lastRewardTimestamp;    // last timestamp updated
        uint256 accSparxPerShare;       // scaled by ACC_PRECISION
        uint256 supply;                 // total tokens staked
        uint256 lockDuration;           // Lock duration in seconds (0 for no lock)
        uint256 lockBonusMultiplier;    // Bonus multiplier in basis points (10000 = 1x)
    }

    struct UserInfo {
        uint256 amount;     // LP amount
        uint256 rewardDebt; // amount*acc - paid
        uint256 lastActionTimestamp; // timestamp of last deposit/harvest/withdraw
        uint256 lastActionBlock;     // block of last deposit/harvest/withdraw
        uint256 lastWithdrawTimestamp; // timestamp of last withdrawal
        uint256 actionsInBlock;      // number of actions in current block
        uint256 unlockTimestamp;     // Timestamp when the user's deposit unlocks
    }

    ISparxToken public immutable sparx;
    address public immutable devTreasury;
    uint256 public devSharePercent;  // Dev share percentage (e.g. 10 = 10%)
    uint256 public totalAllocPoint;
    uint256 public totalMinted;
    uint256 public totalDevMinted;  // Track dev mints separately

    // Emission phases
    struct Phase { uint256 end; uint256 rate; }
    Phase[] public phases;

    // --- New Storage for Token Restriction ---
    mapping(address => bool) public isAllowedLpPair; // Allowed LP Pair addresses
    mapping(address => bool) public poolExists;      // Track if a token already has a pool
    // --- End New Storage ---

    PoolInfo[] public poolInfo;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    // Migration destination and deposit gate
    address public futureFarm;
    bool public depositsEnabled = true;
    bool public harvestingEnabled = true;
    bool public withdrawalsEnabled = true;

    /* ----------------------------------------------------- */
    /* -----------------         EVENTS     ---------------- */
    /* ----------------------------------------------------- */

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Harvest(address indexed user, uint256 indexed pid, uint256 amount);
    event PoolAdded(uint256 indexed pid, address indexed lp, uint256 allocPoint, uint256 lockDuration, uint256 lockBonusMultiplier);
    event PoolSet(uint256 indexed pid, uint256 allocPoint);
    event FutureFarmSet(address indexed oldFarm, address indexed newFarm);
    event TokensMinted(address indexed to, uint256 amount);
    event DepositsEnabled(bool enabled);
    event HarvestingEnabled(bool enabled);
    event WithdrawalsEnabled(bool enabled);
    event UnallocatedSwept(address indexed to, uint256 amount);
    event MinterRoleRelinquished();
    event EmissionRateStopped();
    event MinterRoleGrantAttempt(address indexed farm, bool success);
    event DevShareUpdated(uint256 oldShare, uint256 newShare);
    event DevRewardMinted(uint256 amount);
    event AllowedLpPairAdded(address indexed lpToken);
    event AllowedLpPairRemoved(address indexed lpToken);

    /**
     * @notice Constructs the SparxFarmV2 contract
     * @param _initialOwner Initial owner of the contract
     * @param _sparxToken Address of the SPARX token
     * @param _devTreasury Developer Treasury address
     * @param _schedule Emission schedule as array of [endTimestamp, ratePerSecond] pairs
     */
    constructor(
        address _initialOwner,
        ISparxToken _sparxToken,
        address _devTreasury,
        uint256[2][] memory _schedule
    ) {
        if (_initialOwner == address(0) || _devTreasury == address(0)) revert SparxFarmV2__ZeroAddress();
        sparx = _sparxToken;
        devTreasury = _devTreasury;
        devSharePercent = 10; // Default 10% dev share
        _transferOwnership(_initialOwner);

        uint256 last = block.timestamp;
        for (uint i = 0; i < _schedule.length; ++i) {
            uint256 end = _schedule[i][0];
            uint256 rate = _schedule[i][1];
            
            if (end <= last || rate == 0 || rate > MAX_RATE) revert SparxFarmV2__InvalidPhase();
            
            phases.push(Phase(end, rate));
            last = end;
        }
        
        // Always validate emission schedule, even in test mode
        validateEmissionSchedule(_schedule);
        
        totalAllocPoint = 0; // Initialize totalAllocPoint to 0
    }
    
    /**
     * @notice Validates emission schedule to ensure it sums to expected cap
     * @param _schedule Emission schedule array
     */
    function validateEmissionSchedule(uint256[2][] memory _schedule) internal view {
        // Always validate timestamps are strictly increasing
        for (uint256 i = 1; i < _schedule.length; i++) {
            if (_schedule[i][0] <= _schedule[i-1][0]) {
                revert SparxFarmV2__InvalidEmissionSchedule();
            }
        }
        
        // Calculate total emissions
        uint256 prevTimestamp = block.timestamp;
        uint256 totalEmission = 0;
        
        for (uint256 i = 0; i < _schedule.length; i++) {
            uint256 duration = _schedule[i][0] - prevTimestamp;
            totalEmission += duration * _schedule[i][1];
            prevTimestamp = _schedule[i][0];
        }
        
        // Allow for a small margin of error (0.5%)
        uint256 margin = EMISSIONS_CAP / 200;
        
        if (totalEmission < EMISSIONS_CAP - margin || totalEmission > EMISSIONS_CAP + margin) {
            revert SparxFarmV2__InvalidEmissionSchedule();
        }
    }

    /* ----------------------------------------------------- */
    /* --------------------- MODIFIERS -------------------- */
    /* ----------------------------------------------------- */

    modifier onlyWhenDepositsEnabled() {
        if (!depositsEnabled) {
            // Use both errors for backwards compatibility with tests - Removed testMode reference
            revert SparxFarmV2__DepositsClosed();
        }
        _;
    }

    modifier onlyWhenHarvestingEnabled() {
        if (!harvestingEnabled) revert SparxFarmV2__Paused();
        _;
    }

    modifier onlyWhenWithdrawalsEnabled() {
        if (!withdrawalsEnabled) revert SparxFarmV2__Paused();
        _;
    }

    /**
     * @dev Prevents flash-loan attacks by requiring actions to span multiple blocks
     * @param _pid Pool ID
     */
    modifier noFlash(uint256 _pid) {
        // Removed testMode check
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        // Check if we're in a new block
        if (block.number > user.lastActionBlock) {
            user.actionsInBlock = 0;
        }
        
        // Apply block spacing check only AFTER the first action
        if (user.lastActionBlock > 0 && 
            block.number <= user.lastActionBlock + MIN_STAKE_BLOCKS - 1) {
            revert SparxFarmV2__FlashActionPrevented();
        }
        
        // Check actions per block limit
        if (user.actionsInBlock >= MAX_ACTIONS_PER_BLOCK) {
            revert SparxFarmV2__FlashActionPrevented();
        }
        
        user.actionsInBlock++;
        user.lastActionBlock = block.number;
        _;
    }

    /**
     * @dev Enforces cooldown between user actions
     * @param _pid Pool ID
     */
    modifier cooldownCheck(uint256 _pid) {
        // Removed testMode check
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        if (block.timestamp <= user.lastActionTimestamp + COOLDOWN) {
            revert SparxFarmV2__CooldownActive();
        }
        
        _;
        user.lastActionTimestamp = block.timestamp;
    }

    /**
     * @dev Enforces shorter cooldown for withdrawals
     * @param _pid Pool ID
     */
    modifier withdrawCooldownCheck(uint256 _pid) {
        // Removed testMode check
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        if (block.timestamp <= user.lastWithdrawTimestamp + WITHDRAW_COOLDOWN) {
            revert SparxFarmV2__CooldownActive();
        }
        
        _;
        user.lastWithdrawTimestamp = block.timestamp;
        user.lastActionTimestamp = block.timestamp;
    }

    /* ----------------------------------------------------- */
    /* 2.  VIEW HELPERS                                      */
    /* ----------------------------------------------------- */

    /**
     * @notice Returns the current withdraw cooldown period in seconds
     */
    function getWithdrawCooldown() external pure returns (uint256) {
        return WITHDRAW_COOLDOWN;
    }

    /**
     * @notice Returns the current emission rate based on timestamp
     * @return r Current emission rate per second
     */
    function currentRate() public view returns (uint256 r) {
        // Removed testMode conditional logic
        // Normal production mode always
        uint256 remainingCap = _remainingCap();
        if (remainingCap == 0) return 0;
        
        for (uint i = 0; i < phases.length; ++i) {
            if (block.timestamp < phases[i].end) return phases[i].rate;
        }
        return 0; // Return 0 if we're past all phases
    }

    /**
     * @notice Returns pending SPARX rewards for a user
     * @param _pid Pool ID
     * @param _user User address
     * @return Pending SPARX reward amount
     */
    function pendingRewards(uint256 _pid, address _user) public view returns (uint256) {
        if (_pid >= poolInfo.length) return 0;
        
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage _userInfo = userInfo[_pid][_user];
        uint256 acc = pool.accSparxPerShare;

        if (block.timestamp > pool.lastRewardTimestamp && pool.supply != 0 && pool.allocPoint != 0) {
            uint256 secondsPassed = block.timestamp - pool.lastRewardTimestamp;
            uint256 reward = secondsPassed * currentRate() * pool.allocPoint / totalAllocPoint;
            uint256 remaining = _remainingCap();
            if (reward > remaining) reward = remaining;
            if (reward > 0) {
                acc += reward.mulDiv(ACC_PRECISION, pool.supply);
            }
        }
        
        uint256 pending = _userInfo.amount.mulDiv(acc, ACC_PRECISION);
        return pending > _userInfo.rewardDebt ? pending - _userInfo.rewardDebt : 0;
    }

    /**
     * @notice Returns the number of pools
     * @return Pool count
     */
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    /**
     * @notice Returns the pool info array for tests
     * @return The pool array
     */
    function getPoolInfoArray() external view returns (uint256) {
        return poolInfo.length;
    }

    /**
     * @notice Returns total allocation points across all pools
     * @return Total allocation points
     */
    function totalAllocationPoints() external view returns (uint256) {
        return totalAllocPoint;
    }

    /**
     * @notice Returns all staking token addresses
     * @dev Useful for frontends to identify farm type
     * @return List of LP token addresses
     */
    function stakingTokens() external view returns (address[] memory) {
        uint256 length = poolInfo.length;
        address[] memory tokens = new address[](length);
        
        for (uint256 i = 0; i < length; i++) {
            tokens[i] = address(poolInfo[i].lp);
        }
        
        return tokens;
    }

    /**
     * @notice Calculate remaining tokens that can be minted before cap
     * @return Remaining amount
     */
    function _remainingCap() internal view returns (uint256) {
        uint256 totalSupply = sparx.totalSupply();
        uint256 tokenCap = sparx.CAP();
        
        // If we've reached the token cap, return 0
        if (totalSupply >= tokenCap) return 0;
        
        // Otherwise, return the smaller of the two: farm emissions cap or token cap
        uint256 tokenRemaining = tokenCap - totalSupply;
        uint256 farmRemaining = EMISSIONS_CAP > totalMinted ? EMISSIONS_CAP - totalMinted : 0;
        
        return tokenRemaining < farmRemaining ? tokenRemaining : farmRemaining;
    }

    /**
     * @notice Returns the full UserInfo struct for a specific user in a pool.
     * @param _pid Pool ID
     * @param _user User address
     * @return Full UserInfo struct for the user in the specified pool
     */
    function getUserInfo(uint256 _pid, address _user) external view returns (UserInfo memory) {
        if (_pid >= poolInfo.length) revert InvalidPid();
        return userInfo[_pid][_user];
    }

    /* ----------------------------------------------------- */
    /* 3.  POOL MGMT (owner)                                 */
    /* ----------------------------------------------------- */

    /**
     * @notice Adds a new allowed LP pair token address.
     * @param _lpToken The address of the LP token contract to allow.
     */
    function addAllowedLpPair(address _lpToken) external onlyOwner {
        if (_lpToken == address(0)) revert SparxFarmV2__ZeroAddress();
        if (isAllowedLpPair[_lpToken]) revert SparxFarmV2__TokenAlreadyAllowed();
        // Ensure it's not the SPARX token itself being added here
        if (_lpToken == address(sparx)) revert SparxFarmV2__TokenNotAllowed(); 

        isAllowedLpPair[_lpToken] = true;
        emit AllowedLpPairAdded(_lpToken);
    }

    /**
     * @notice Removes an allowed LP pair token address.
     * @param _lpToken The address of the LP token contract to disallow.
     */
    function removeAllowedLpPair(address _lpToken) external onlyOwner {
        if (!isAllowedLpPair[_lpToken]) revert SparxFarmV2__TokenNotAllowedToRemove();
        
        isAllowedLpPair[_lpToken] = false;
        emit AllowedLpPairRemoved(_lpToken);
        // Note: This does not remove existing pools using this token.
        // Owner should set allocPoint to 0 for pools they wish to deprecate.
    }

    /**
     * @notice Add a new pool for an allowed token (SPARX or approved LP Pair).
     * @param _allocPoint Allocation points for the pool.
     * @param _token The address of the token to add (must be SPARX or an allowed LP Pair).
     * @param _lockDuration Lock duration in seconds (e.g., 30 * 86400 for 30 days). 0 for no lock.
     * @param _lockBonusMultiplier Bonus reward multiplier in basis points (e.g., 11000 for 1.1x). Must be >= 10000.
     */
    function addPool(
        uint256 _allocPoint,
        address _token,
        uint256 _lockDuration,
        uint256 _lockBonusMultiplier
    ) external onlyOwner whenNotPaused {
        if (poolInfo.length >= MAX_POOLS) revert SparxFarmV2__MaxPoolsReached();
        if (_token == address(0)) revert SparxFarmV2__ZeroAddress();
        if (poolExists[_token]) revert SparxFarmV2__PoolAlreadyExists();
        require(_lockBonusMultiplier >= 10000, "SparxFarmV2: Bonus must be >= 1x"); // Validate bonus multiplier

        // Check if the token is allowed
        bool isSparxToken = (_token == address(sparx));
        if (!isSparxToken && !isAllowedLpPair[_token]) {
            revert SparxFarmV2__TokenNotAllowed();
        }

        massUpdatePools();

        uint256 newPoolId = poolInfo.length;
        IERC20 lpTokenInterface = IERC20(_token);

        poolInfo.push(PoolInfo({
            lp: lpTokenInterface,
            allocPoint: _allocPoint,
            lastRewardTimestamp: block.timestamp,
            accSparxPerShare: 0,
            supply: 0,
            lockDuration: _lockDuration,           // NEW
            lockBonusMultiplier: _lockBonusMultiplier // NEW
        }));

        poolExists[_token] = true; // Mark token as having a pool
        totalAllocPoint += _allocPoint;
        emit PoolAdded(newPoolId, _token, _allocPoint, _lockDuration, _lockBonusMultiplier); // Updated Event
    }

    /**
     * @notice Update allocation points for a pool
     * @param _pid Pool ID
     * @param _allocPoint New allocation points
     */
    function setPool(uint256 _pid, uint256 _allocPoint) external onlyOwner whenNotPaused {
        if (_pid >= poolInfo.length) revert InvalidPid();
        
        // Check for maximum allocation points
        if (_allocPoint > MAX_ALLOC_POINTS) {
            revert SparxFarmV2__InvalidAllocPoint();
        }
        
        massUpdatePools();
        totalAllocPoint = totalAllocPoint - poolInfo[_pid].allocPoint + _allocPoint;
        poolInfo[_pid].allocPoint = _allocPoint;
        emit PoolSet(_pid, _allocPoint);
    }

    /* ----------------------------------------------------- */
    /* 4.  CORE ACTIONS                                      */
    /* ----------------------------------------------------- */

    /**
     * @notice Deposit LP tokens for SPARX rewards
     * @param _pid Pool ID
     * @param _amount Amount of LP tokens to deposit
     * @dev Follows checks-effects-interactions pattern:
     *      1. All checks (pool validity, non-zero LP, etc)
     *      2. State updates (pool supply, user amount)
     *      3. External interactions (token transfers)
     */
    function deposit(uint256 _pid, uint256 _amount) 
        external 
        whenNotPaused 
        nonReentrant 
        noFlash(_pid) 
        cooldownCheck(_pid) 
        onlyWhenDepositsEnabled 
    {
        // CHECKS
        if (_pid >= poolInfo.length) revert InvalidPid();
        PoolInfo storage pool = poolInfo[_pid];
        if (address(pool.lp) == address(0)) revert InvalidAddress();
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        _updatePool(pool);
        
        // Calculate pending rewards with current state BEFORE updating user amount
        uint256 basePending = pendingRewards(_pid, msg.sender);
        
        // EFFECTS
        // Update state before any external calls
        if (_amount > 0) {
            pool.supply += _amount;
            user.amount += _amount;
        }
        // IMPORTANT: Update rewardDebt based on accumulator *before* bonus is applied
        user.rewardDebt = user.amount.mulDiv(pool.accSparxPerShare, ACC_PRECISION);
        user.lastActionBlock = block.number;
        user.lastActionTimestamp = block.timestamp;

        // Set or reset unlock timestamp if there's a lock duration
        if (pool.lockDuration > 0) {
            user.unlockTimestamp = block.timestamp + pool.lockDuration;
        } else {
            user.unlockTimestamp = 0; // Ensure it's 0 if pool has no lock
        }

        // Initialize lastWithdrawTimestamp on first deposit
        if (user.lastWithdrawTimestamp == 0) {
            user.lastWithdrawTimestamp = block.timestamp;
        }

        // INTERACTIONS
        // Handle token transfers after state updates
        if (_amount > 0) {
            pool.lp.safeTransferFrom(msg.sender, address(this), _amount);
        }
        
        // Apply bonus multiplier and mint rewards
        if (basePending > 0 && harvestingEnabled) {
            uint256 finalReward = (basePending * pool.lockBonusMultiplier) / 10000;
            if (finalReward > 0) { // Check final amount after potential rounding
                _safeMint(msg.sender, finalReward);
                emit Harvest(msg.sender, _pid, finalReward);
            }
        }
        
        emit Deposit(msg.sender, _pid, _amount);
    }

    /**
     * @notice Withdraw LP tokens from farm
     * @param _pid Pool ID
     * @param _amount Amount of LP tokens to withdraw
     * @dev Note: LP token transfer happens *after* state updates. This is safe for standard ERC20/LP tokens,
     *      but could pose a re-entrancy risk if supporting tokens with callbacks (e.g., ERC777).
     *      If untrusted tokens are ever supported, mirror the deposit pattern (transfer first).
     */
    function withdraw(uint256 _pid, uint256 _amount) 
        external 
        whenNotPaused 
        nonReentrant 
        noFlash(_pid) 
        withdrawCooldownCheck(_pid) 
        onlyWhenWithdrawalsEnabled 
    {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        // --- LOCK CHECK ---
        if (pool.lockDuration > 0) {
            if (block.timestamp < user.unlockTimestamp) {
                revert SparxFarmV2__StakeLocked();
            }
        }
        // --- END LOCK CHECK ---

        if (user.amount < _amount) revert SparxFarmV2__InsufficientBalance();
        
        _updatePool(pool);
        
        // Calculate base pending rewards BEFORE updating user amount
        uint256 basePending = pendingRewards(_pid, msg.sender);

        // Apply bonus and mint rewards if harvesting enabled
        if (basePending > 0 && harvestingEnabled) {
            uint256 finalReward = (basePending * pool.lockBonusMultiplier) / 10000;
            if (finalReward > 0) {
                _safeMint(msg.sender, finalReward);
                emit Harvest(msg.sender, _pid, finalReward);
            }
        }

        // Process withdrawal AFTER reward calculation
        if (_amount > 0) {
            user.amount -= _amount;
            pool.supply -= _amount;
            pool.lp.safeTransfer(msg.sender, _amount);
        }
        
        // IMPORTANT: Update rewardDebt based on accumulator *before* bonus was applied
        user.rewardDebt = user.amount.mulDiv(pool.accSparxPerShare, ACC_PRECISION);
        user.lastActionBlock = block.number;
        user.lastWithdrawTimestamp = block.timestamp;
        
        emit Withdraw(msg.sender, _pid, _amount);
    }

    /**
     * @notice Harvest pending SPARX rewards
     * @param _pid Pool ID
     */
    function harvest(uint256 _pid) 
        external 
        whenNotPaused 
        nonReentrant 
        cooldownCheck(_pid) 
        noFlash(_pid) 
        onlyWhenHarvestingEnabled 
    {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        _updatePool(pool);
        uint256 basePending = pendingRewards(_pid, msg.sender);
        if (basePending == 0) revert SparxFarmV2__NothingToHarvest();

        // Apply bonus multiplier
        uint256 finalReward = (basePending * pool.lockBonusMultiplier) / 10000;

        if (finalReward > 0) { // Check final amount after potential rounding
            _safeMint(msg.sender, finalReward);
        }

        // IMPORTANT: Update rewardDebt based on accumulator *before* bonus was applied
        user.rewardDebt = user.amount.mulDiv(pool.accSparxPerShare, ACC_PRECISION);
        user.lastActionBlock = block.number;

        if (finalReward > 0) {
             emit Harvest(msg.sender, _pid, finalReward);
        }
    }

    /**
     * @notice Emergency withdraw without caring about rewards
     * @param _pid Pool ID
     */
    function emergencyWithdraw(uint256 _pid) external nonReentrant {
        if (!paused()) revert ContractMustBePaused();
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;
        pool.lp.safeTransfer(address(msg.sender), amount);
        emit Withdraw(msg.sender, _pid, amount);
    }

    /**
     * @notice Harvest rewards and send them to a specified address
     * @param _pid Pool ID to harvest from
     * @param _to Address to receive the rewards
     * @dev This function allows harvesting rewards to any non-zero address.
     * @dev NOTE: If the recipient address is not fee-exempt, standard transfer fees may apply.
     * @dev In production mode (testMode = false), harvesting is restricted to fee-exempt addresses or devTreasury to avoid fees on minted tokens.
     * @dev Emits:
     *      - Harvest event on successful harvest
     * @dev Reverts if:
     *      - _to is zero address
     *      - Pool ID is invalid
     *      - Contract is paused
     *      - Harvesting is disabled
     */
    function harvestTo(uint256 _pid, address _to) 
        external 
        nonReentrant 
        whenNotPaused 
        onlyWhenHarvestingEnabled 
    {
        if (_pid >= poolInfo.length) revert InvalidPid();
        if (_to == address(0)) revert InvalidAddress();

        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        _updatePool(pool);
        
        uint256 pending = user.amount.mulDiv(pool.accSparxPerShare, ACC_PRECISION) - user.rewardDebt;
        if (pending > 0) {
            // Update reward debt before minting to prevent reentrancy
            user.rewardDebt = user.amount.mulDiv(pool.accSparxPerShare, ACC_PRECISION);
            
            // Safe mint with cap check
            if (totalMinted + pending > _remainingCap()) {
                pending = _remainingCap() - totalMinted;
                if (pending == 0) revert SparxFarmV2__EmissionsCapReached();
            }
            totalMinted += pending;
            
            // Mint directly to specified address
            sparx.mint(_to, pending);
            emit Harvest(msg.sender, _pid, pending);
        }
    }

    /* ----------------------------------------------------- */
    /* 5.  INTERNALS                                         */
    /* ----------------------------------------------------- */

    /**
     * @notice Update reward variables for a pool
     * @param _pool Pool to update
     */
    function _updatePool(PoolInfo storage _pool) internal {
        uint256 lastRewardTimestamp = _pool.lastRewardTimestamp;
        uint256 lpSupply = _pool.supply;
        uint256 currentTimestamp = block.timestamp;

        if (currentTimestamp <= lastRewardTimestamp) {
            return;
        }

        if (lpSupply == 0 || _pool.allocPoint == 0) {
            _pool.lastRewardTimestamp = currentTimestamp;
            return;
        }

        uint256 timeElapsed = currentTimestamp - lastRewardTimestamp;
        uint256 reward = (timeElapsed * currentRate() * _pool.allocPoint) / totalAllocPoint;

        // Cap reward per update to prevent extreme values
        if (reward > MAX_REWARD_PER_UPDATE) {
            reward = MAX_REWARD_PER_UPDATE;
        }

        // Calculate dev share
        uint256 devReward = 0;
        if (devSharePercent > 0) {
            devReward = (reward * devSharePercent) / DEV_SHARE_DENOMINATOR;
            
            // Check emissions cap including dev share
            if (totalMinted + reward + devReward > _remainingCap()) {
                uint256 remaining = _remainingCap() - totalMinted;
                if (remaining == 0) {
                    _pool.lastRewardTimestamp = currentTimestamp;
                    return;
                }
                // Adjust both rewards proportionally
                uint256 total = reward + devReward;
                reward = (remaining * reward) / total;
                devReward = (remaining * devReward) / total;
            }

            // Mint dev share if non-zero
            if (devReward > 0) {
                sparx.mint(devTreasury, devReward);
                totalDevMinted += devReward;
                emit DevRewardMinted(devReward);
            }
        } else {
            // No dev share, just check main reward against cap
            if (totalMinted + reward > _remainingCap()) {
                reward = _remainingCap() - totalMinted;
                if (reward == 0) {
                    _pool.lastRewardTimestamp = currentTimestamp;
                    return;
                }
            }
        }

        _pool.accSparxPerShare += (reward * ACC_PRECISION) / lpSupply;
        _pool.lastRewardTimestamp = currentTimestamp;
        totalMinted += reward + devReward;
    }

    /**
     * @notice Update reward variables for all pools
     * @dev Be careful of gas spending!
     */
    function massUpdatePools() public whenNotPaused {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            _updatePool(poolInfo[pid]);
        }
    }

    /**
     * @notice Update reward variables of the given pool to be up-to-date
     * @param _pid Pool ID
     */
    function updatePool(uint256 _pid) public whenNotPaused {
        if (_pid >= poolInfo.length) revert InvalidPid();
        _updatePool(poolInfo[_pid]);
    }

    /**
     * @notice Safely mint tokens respecting both farm and token caps
     * @dev This function implements a dual-check mechanism for minting:
     *      1. First check: Farm's _remainingCap() ensures farm-level cap compliance
     *      2. Second check: SparxToken's mint() ensures token-level cap compliance
     * @dev Note: In extremely rare cases of concurrent transactions, the actual minted
     *      amount might exceed the cap by a few wei due to the dual-check nature.
     *      This is considered an acceptable trade-off vs. the complexity of implementing locks.
     * @param _to Address to mint tokens to
     * @param _amount Amount of tokens to mint
     */
    function _safeMint(address _to, uint256 _amount) internal {
        if (_amount == 0) return;
        
        uint256 remaining = _remainingCap();
        if (remaining < _amount) {
            _amount = remaining;
        }
        
        if (_amount > 0) {
            sparx.mint(_to, _amount);
            emit TokensMinted(_to, _amount);
        }
    }

    /* ----------------------------------------------------- */
    /* 6.  MIGRATION FUNCTIONS                               */
    /* ----------------------------------------------------- */

    /**
     * @notice Set the address of the future farm
     * @param _newFarm Address of the new farm contract (can be 0x0 to clear)
     */
    function setFutureFarm(address _newFarm) external onlyOwner whenNotPaused {
        if (_newFarm == futureFarm) revert MigrationNotAllowed();
        address oldFarm = futureFarm;
        futureFarm = _newFarm;
        
        // Only attempt to grant role if new farm is set
        if (_newFarm != address(0)) {
            try sparx.grantRole(MINTER_ROLE, _newFarm) {
                // Role granted successfully
                emit MinterRoleGrantAttempt(_newFarm, true);
            } catch {
                // If role grant fails, continue anyway as the owner can grant the role separately
                emit MinterRoleGrantAttempt(_newFarm, false);
            }
        }
        
        emit FutureFarmSet(oldFarm, _newFarm);
    }

    /**
     * @notice Toggle deposit functionality
     * @param _enabled Whether deposits should be enabled
     */
    function toggleDeposits(bool _enabled) external onlyOwner whenNotPaused {
        depositsEnabled = _enabled;
        emit DepositsEnabled(_enabled);
    }

    /**
     * @notice Toggle harvesting functionality
     * @param _enabled Whether harvesting should be enabled
     */
    function toggleHarvesting(bool _enabled) external onlyOwner whenNotPaused {
        harvestingEnabled = _enabled;
        emit HarvestingEnabled(_enabled);
    }

    /**
     * @notice Toggle withdrawal functionality
     * @param _enabled Whether withdrawals should be enabled
     */
    function toggleWithdrawals(bool _enabled) external onlyOwner whenNotPaused {
        withdrawalsEnabled = _enabled;
        emit WithdrawalsEnabled(_enabled);
    }

    /**
     * @notice Stop all SPARX rewards permanently (used during migration)
     * @dev This function effectively stops all emissions by setting all phases to end
     */
    function stopRewards() external onlyOwner whenNotPaused {
        uint256 length = phases.length;
        for (uint i = 0; i < length; i++) {
            phases[i].end = block.timestamp;
        }
        emit EmissionRateStopped(); // Emit event after loop completes
    }

    /**
     * @notice Sweep unallocated SPARX tokens to another address
     * @param _to Recipient address
     */
    function sweepUnallocated(address _to) external onlyOwner whenNotPaused {
        if (futureFarm == address(0)) revert SparxFarmV2__FutureFarmNotSet();
        if (_to == address(0)) revert SparxFarmV2__ZeroAddress();
        
        uint256 bal = sparx.balanceOf(address(this));
        if (bal > 0) {
            sparx.transfer(_to, bal);
            emit UnallocatedSwept(_to, bal);
        }
    }

    /**
     * @notice Relinquish minter role once migration is complete
     */
    function relinquishMinterRole() external onlyOwner whenNotPaused {
        if (futureFarm == address(0)) revert SparxFarmV2__FutureFarmNotSet();
        
        sparx.revokeRole(MINTER_ROLE, address(this));
        emit MinterRoleRelinquished();
    }

    /**
     * @notice Pause the contract in emergency
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Helper to check if farm has reached emissions cap
     * @return True if cap reached
     */
    function capReached() external view returns (bool) {
        return _remainingCap() == 0;
    }

    /**
     * @notice Get cooldown info for a user's pool position
     * @param _pid Pool ID
     * @param _user User address
     * @return lastBlock Last block number when user took action
     * @return lastTimestamp Last timestamp when user took action
     * @return lastWithdrawTimestamp Last timestamp when user withdrew
     * @return cooldownEnds When cooldown period ends
     * @return withdrawCooldownEnds When withdraw cooldown period ends
     * @return isCooldownActive Whether cooldown is currently active
     * @return isWithdrawCooldownActive Whether withdraw cooldown is currently active
     */
    function userCooldownInfo(uint256 _pid, address _user) external view returns (
        uint256 lastBlock,
        uint256 lastTimestamp,
        uint256 lastWithdrawTimestamp,
        uint256 cooldownEnds,
        uint256 withdrawCooldownEnds,
        bool isCooldownActive,
        bool isWithdrawCooldownActive
    ) {
        UserInfo storage user = userInfo[_pid][_user];
        uint256 cooldownEnd = user.lastActionTimestamp + COOLDOWN;
        uint256 withdrawCooldownEnd = user.lastWithdrawTimestamp + WITHDRAW_COOLDOWN;
        
        return (
            user.lastActionBlock,
            user.lastActionTimestamp,
            user.lastWithdrawTimestamp,
            cooldownEnd,
            withdrawCooldownEnd,
            block.timestamp < cooldownEnd,
            block.timestamp < withdrawCooldownEnd
        );
    }

    /**
     * @notice Returns farm configuration for frontends
     * @return farmCap Maximum emissions cap
     * @return minted Total amount minted so far from SparxToken
     * @return remaining Amount that can still be minted
     * @return currentEmissionRate Current emission rate per second
     * @return isDepositsEnabled Whether deposits are currently enabled
     * @return hasNewFarm Whether a future farm has been set
     */
    function getFarmInfo() external view returns (
        uint256 farmCap,
        uint256 minted,
        uint256 remaining,
        uint256 currentEmissionRate,
        bool isDepositsEnabled,
        bool hasNewFarm
    ) {
        return (
            EMISSIONS_CAP,
            totalMinted,
            _remainingCap(),
            currentRate(),
            depositsEnabled,
            futureFarm != address(0)
        );
    }
    
    /**
     * @notice Returns information about the current emission phase
     * @return currentPhaseIndex Index of the current phase (or phases.length if past all phases)
     * @return currentPhaseEnd Timestamp when current phase ends
     * @return currentPhaseRate Emission rate for current phase
     * @return secondsRemaining Seconds remaining in current phase
     * @return percentComplete Percentage of total farm emissions completed (0-10000)
     */
    function getEmissionPhaseInfo() external view returns (
        uint256 currentPhaseIndex,
        uint256 currentPhaseEnd,
        uint256 currentPhaseRate,
        uint256 secondsRemaining,
        uint256 percentComplete
    ) {
        // Removed testMode conditional logic
        // Find current phase
        for (uint256 i = 0; i < phases.length; ++i) {
            if (block.timestamp < phases[i].end) {
                currentPhaseIndex = i;
                currentPhaseEnd = phases[i].end;
                currentPhaseRate = phases[i].rate;
                secondsRemaining = phases[i].end - block.timestamp;
                break;
            }
        }
        
        // If we're past all phases
        if (currentPhaseEnd == 0) {
            currentPhaseIndex = phases.length;
        }
        
        // Calculate percentage of emissions completed
        uint256 totalSupply = sparx.totalSupply();
        if (totalSupply > 100_000_000 ether) {  // Account for initial 100M
            uint256 farmEmissions = totalSupply - 100_000_000 ether;
            percentComplete = farmEmissions * 10000 / EMISSIONS_CAP;
        }
        
        return (
            currentPhaseIndex,
            currentPhaseEnd,
            currentPhaseRate,
            secondsRemaining,
            percentComplete
        );
    }
    
    /**
     * @notice Returns distribution statistics for all pools
     * @return poolCount Number of active pools
     * @return poolAddresses LP token addresses for each pool
     * @return allocPoints Allocation points for each pool
     * @return poolSupplies Total staked LP amount for each pool
     * @return distributionShares Percentage share of rewards for each pool (0-10000)
     */
    function getPoolDistributionInfo() external view returns (
        uint256 poolCount,
        address[] memory poolAddresses,
        uint256[] memory allocPoints,
        uint256[] memory poolSupplies,
        uint256[] memory distributionShares
    ) {
        poolCount = poolInfo.length;
        poolAddresses = new address[](poolCount);
        allocPoints = new uint256[](poolCount);
        poolSupplies = new uint256[](poolCount);
        distributionShares = new uint256[](poolCount);
        
        for (uint256 i = 0; i < poolCount; ++i) {
            PoolInfo storage pool = poolInfo[i];
            poolAddresses[i] = address(pool.lp);
            allocPoints[i] = pool.allocPoint;
            poolSupplies[i] = pool.supply;
            
            if (totalAllocPoint > 0) {
                distributionShares[i] = (pool.allocPoint * 10000) / totalAllocPoint;
            }
        }
        
        // Ensure shares sum to exactly 10000 by adjusting the last non-zero share if needed
        if (poolCount > 0 && totalAllocPoint > 0) {
            uint256 totalShares = 0;
            uint256 lastNonZeroIndex = 0;
            
            for (uint256 i = 0; i < poolCount; ++i) {
                totalShares += distributionShares[i];
                if (distributionShares[i] > 0) {
                    lastNonZeroIndex = i;
                }
            }
            
            if (totalShares != 10000 && distributionShares[lastNonZeroIndex] > 0) {
                // Adjust the last non-zero share to make the total exactly 10000
                if (totalShares < 10000) {
                    distributionShares[lastNonZeroIndex] += (10000 - totalShares);
                } else {
                    distributionShares[lastNonZeroIndex] -= (totalShares - 10000);
                }
            }
        }
        
        return (
            poolCount,
            poolAddresses,
            allocPoints,
            poolSupplies,
            distributionShares
        );
    }

    /**
     * @notice Set the dev share percentage
     * @param _newSharePercent New dev share percentage (0-100)
     * @dev A value of 0 disables dev share
     */
    function setDevShare(uint256 _newSharePercent) external onlyOwner {
        require(_newSharePercent <= 20, "Dev share cannot exceed 20%");
        uint256 oldShare = devSharePercent;
        devSharePercent = _newSharePercent;
        emit DevShareUpdated(oldShare, _newSharePercent);
    }

    /**
     * @notice Get dev share info
     * @return share Current dev share percentage
     * @return totalMintedToDevs Total amount minted to dev treasury
     * @return treasury Dev treasury address
     */
    function getDevShareInfo() external view returns (
        uint256 share,
        uint256 totalMintedToDevs,
        address treasury
    ) {
        return (devSharePercent, totalDevMinted, devTreasury);
    }

    /**
     * @notice Get lock info for a user's pool position
     * @param _pid Pool ID
     * @param _user User address
     * @return lockDuration Lock duration for this pool in seconds
     * @return bonusMultiplier Bonus multiplier for this pool (10000 = 1x)
     * @return userUnlockTimestamp Timestamp when the user's stake unlocks (0 if no lock or no deposit)
     * @return secondsRemaining Seconds remaining until unlock (0 if unlocked or no lock)
     */
    function getUserLockInfo(uint256 _pid, address _user) external view returns (
        uint256 lockDuration,
        uint256 bonusMultiplier,
        uint256 userUnlockTimestamp,
        uint256 secondsRemaining
    ) {
        require(_pid < poolInfo.length, "SparxFarmV2: Invalid PID");
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];

        lockDuration = pool.lockDuration;
        bonusMultiplier = pool.lockBonusMultiplier;
        userUnlockTimestamp = user.unlockTimestamp;

        if (userUnlockTimestamp > block.timestamp) {
            secondsRemaining = userUnlockTimestamp - block.timestamp;
        } else {
            secondsRemaining = 0; // Already unlocked or never locked
        }
    }
} 