// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";

// Custom Errors
error Sparx__ZeroAddress();
error Sparx__MaxFeeExemptReached();
error Sparx__CannotRemoveCoreExemption();
error Sparx__TradingAlreadyEnabled();
error Sparx__CapExceeded();
error Sparx__BurnerVaultNotSet();
error Sparx__NotAuthorized();
error Sparx__MaxMintersReached();
error Sparx__AlreadyMinter();
error Sparx__NotMinter();
error Sparx__MinterExpired();
error Sparx__ZeroAmount();
error Sparx__TradingNotEnabled();
error Sparx__InsufficientBalance(address account, uint256 balance, uint256 needed);
error Sparx__TransferFromZeroAddress();
error Sparx__TransferToZeroAddress();
error OwnableUnauthorizedAccount(address account);
error SparxToken__InvalidAmount();
error SparxToken__TransferFailed();
error SparxToken__InvalidFeeValues();

/**
 * @title SparxToken
 * @notice SPARX token for XenFerno Farms with 3% transfer fee (1% dev treasury, 2% burner)
 * @dev Implements fee-on-transfer mechanism with exemptions and hard cap
 */
contract SparxToken is ERC20, ERC20Capped, AccessControl {
    using Math for uint256;

    /// @notice Minter role for controlled minting access
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Maximum supply cap (1 billion tokens)
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10**18;  // 1 billion tokens
    uint256 public constant CAP = TOTAL_SUPPLY;
    
    /// @notice Fee denominator for percentage calculations (10,000 = 100%)
    uint256 public constant FEE_DENOMINATOR = 10000;
    
    /// @notice Total fee as basis points (500 = 5%)
    uint256 private _totalFee = 500;
    
    /// @notice Dev treasury fee as basis points (100 = 1%)
    uint256 private _devFee = 100;
    
    /// @notice Burner vault fee as basis points (400 = 4%)
    uint256 private _burnerFee = 400;
    
    /// @notice Maximum number of fee-exempt addresses
    /// @dev Increased to accommodate router, factory, multiple LP pairs, burner vault, dev treasury etc.
    uint256 public constant MAX_FEE_EXEMPT = 25;
    
    /// @notice Maximum number of minter addresses
    uint256 public constant MAX_MINTERS = 5;

    /// @notice Developer treasury address (updatable by admin)
    address public devTreasury;
    
    /// @notice Burner vault address that collects fees for later burning
    address public burnerVault;
    
    /// @notice Mapping of addresses exempt from fees
    mapping(address => bool) public isFeeExempt;
    
    /// @notice Number of addresses currently exempt from fees
    uint256 public feeExemptCount;

    /// @notice Flag indicating if fee-on-transfer trading is enabled
    bool public tradingEnabled = false;
    
    /// @notice Tracks fee-exempt addresses for enumeration
    address[] private feeExemptAddresses;

    /// @notice Track number of minters for limit check
    uint256 private _minterCount = 0;

    /// @notice Tracks minter addresses for enumeration
    address[] private _minterAddresses;

    /// @notice SPARX Burner contract address for minting rebates
    address public immutable sparxBurner;

    /// @notice Emitted when an address exemption status changes
    event FeeExemptionUpdated(address indexed account, bool isExempt);
    
    /// @notice Emitted when trading is enabled
    event TradingEnabled();
    
    /// @notice Emitted when a minter status changes
    event MinterStatusUpdated(address indexed account, bool isMinter);

    /// @notice Emitted when fees are transferred
    event FeeTransferred(address indexed from, address indexed to, uint256 amount, bool isDevFee);
    
    /// @notice Emitted when tokens are minted
    event TokensMinted(address indexed minter, address indexed recipient, uint256 amount, uint256 newTotalSupply);

    /// @notice Emitted when a role change is pending
    event RoleChangePending(bytes32 indexed role, address indexed account, bool isGrant, uint256 timestamp);

    /// @notice Emitted when fees are updated
    event FeesUpdated(uint256 devFee, uint256 burnerFee, uint256 totalFee);

    /// @notice Emitted when the dev treasury address is updated
    event DevTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /// @notice Emitted whenever SPARX tokens are burned
    event SparxBurned(address indexed from, uint256 amount);

    /**
     * @notice Constructs the SparxToken contract
     * @param _devTreasury Initial address of developer treasury
     * @param _burnerVault Address of SparxBurner contract that collects fees for burning
     * @param _burnerContract Address of the SPARX Burner contract
     */
    constructor(
        address _devTreasury,
        address _burnerVault,
        address _burnerContract
    ) ERC20("Sparx", "SPARX") ERC20Capped(1_000_000_000 * 10**18) {
        if (_devTreasury == address(0) || _burnerVault == address(0) || _burnerContract == address(0))
            revert Sparx__ZeroAddress();

        devTreasury = _devTreasury;
        burnerVault = _burnerVault;
        sparxBurner = _burnerContract;
        
        // Set initial fee exemptions
        _setFeeExempt(msg.sender, true); // Owner/deployer
        _setFeeExempt(address(this), true); // Token contract
        _setFeeExempt(_devTreasury, true); // Treasury
        _setFeeExempt(_burnerVault, true); // Burner vault
        _setFeeExempt(_burnerContract, true); // Burner contract
        
        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, _burnerVault);
        _minterCount = 2; // Owner and burner vault are minters
        _minterAddresses.push(msg.sender);
        _minterAddresses.push(_burnerVault);
        
        // Emit initial setup events
        emit MinterStatusUpdated(msg.sender, true);
        emit MinterStatusUpdated(_burnerVault, true);
    }

    /**
     * @notice Enables fee-on-transfer trading
     * @dev Can only be called once by the owner
     */
    function enableTrading() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (tradingEnabled) revert Sparx__TradingAlreadyEnabled();
        tradingEnabled = true;
        emit TradingEnabled();
    }

    /**
     * @notice Mints new tokens, respecting the cap
     * @param account Recipient of the minted tokens
     * @param amount Amount of tokens to mint
     */
    function mint(address account, uint256 amount) external {
        if (!hasRole(MINTER_ROLE, msg.sender)) 
            revert("AccessControl: account is missing role");
        
        if (totalSupply() + amount > CAP) revert Sparx__CapExceeded();
        _mint(account, amount);
        
        // Emit minting event with new total supply
        emit TokensMinted(msg.sender, account, amount, totalSupply());
    }
    
    /**
     * @notice Adds an address as a minter
     * @dev Can only be called by the owner (DEFAULT_ADMIN_ROLE)
     * @param _minter Address to grant minter role to
     */
    function addMinter(address _minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_minter == address(0)) revert Sparx__ZeroAddress();
        if (hasRole(MINTER_ROLE, _minter)) revert Sparx__AlreadyMinter(); // Check if already minter
        if (_minterCount >= MAX_MINTERS) revert Sparx__MaxMintersReached();
        
        _grantRole(MINTER_ROLE, _minter);
        _minterCount++;
        _minterAddresses.push(_minter);
        emit MinterStatusUpdated(_minter, true);
    }

    /**
     * @notice Removes an address as a minter
     * @dev Can only be called by the owner (DEFAULT_ADMIN_ROLE)
     * @param _minter Address to revoke minter role from
     */
    function removeMinter(address _minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_minter == address(0)) revert Sparx__ZeroAddress();
        if (!hasRole(MINTER_ROLE, _minter)) revert Sparx__NotMinter(); // Check if actually a minter

        _revokeRole(MINTER_ROLE, _minter);
        // Safe decrement: _minterCount should always be > 0 if role existed
        _minterCount--; 

        // Remove from minterAddresses array (swap and pop)
        for (uint256 i = 0; i < _minterAddresses.length; i++) {
            if (_minterAddresses[i] == _minter) {
                _minterAddresses[i] = _minterAddresses[_minterAddresses.length - 1];
                _minterAddresses.pop();
                break;
            }
        }
        
        emit MinterStatusUpdated(_minter, false);
    }

    /**
     * @notice Sets an address as fee exempt or not
     * @dev Limited by MAX_FEE_EXEMPT, can only be called by owner
     * @param account Address to update exemption status for
     * @param exempt True to exempt from fees, false to remove exemption
     */
    function setFeeExempt(address account, bool exempt) external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender))
            revert OwnableUnauthorizedAccount(msg.sender);
        _setFeeExempt(account, exempt);
    }

    /**
     * @notice Sets the address for the developer treasury
     * @dev Can only be called by the owner (DEFAULT_ADMIN_ROLE)
     * @param _newTreasury The new developer treasury address
     */
    function setDevTreasury(address _newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newTreasury == address(0)) revert Sparx__ZeroAddress();
        address oldTreasury = devTreasury;
        devTreasury = _newTreasury;
        
        // Update fee exemption if the old treasury was exempt
        if (isFeeExempt[oldTreasury]) {
            _setFeeExempt(oldTreasury, false);
            _setFeeExempt(_newTreasury, true);
        }
        
        emit DevTreasuryUpdated(oldTreasury, _newTreasury);
    }

    /**
     * @notice Sets the address for the burner vault
     * @dev Can only be called by the owner (DEFAULT_ADMIN_ROLE)
     * @param _burnerVault The new burner vault address
     */
    function setBurnerVault(address _burnerVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_burnerVault == address(0)) revert Sparx__ZeroAddress();
        burnerVault = _burnerVault;
        // Optionally emit an event here if needed, e.g., emit BurnerVaultUpdated(_burnerVault);
    }

    /**
     * @notice Internal function to set fee exemptions and manage count
     * @param account Address to update exemption status for
     * @param exempt True to exempt from fees, false to remove exemption
     */
    function _setFeeExempt(address account, bool exempt) internal {
        if (account == address(0)) revert Sparx__ZeroAddress();
        
        // If already in the desired state, return early
        if (isFeeExempt[account] == exempt) return;

        // Prevent removal of core exemptions (owner, token, treasury, burner)
        if (!exempt && (
            hasRole(DEFAULT_ADMIN_ROLE, account) ||
            account == address(this) ||
            account == devTreasury ||
            account == burnerVault ||
            account == sparxBurner
        )) revert Sparx__CannotRemoveCoreExemption();

        // Check max exempt limit when adding new exemption
        if (exempt && feeExemptCount >= MAX_FEE_EXEMPT) revert Sparx__MaxFeeExemptReached();

        // Update exemption status and count
        isFeeExempt[account] = exempt;
        if (exempt) {
            feeExemptAddresses.push(account);
            feeExemptCount++;
        } else {
            // Remove from feeExemptAddresses array
            for (uint256 i = 0; i < feeExemptAddresses.length; i++) {
                if (feeExemptAddresses[i] == account) {
                    feeExemptAddresses[i] = feeExemptAddresses[feeExemptAddresses.length - 1];
                    feeExemptAddresses.pop();
                    break;
                }
            }
            feeExemptCount--;
        }

        emit FeeExemptionUpdated(account, exempt);
    }

    /**
     * @notice Override transfer function to implement fee logic
     * @param recipient The address to transfer to
     * @param amount The amount to transfer
     */
    function transfer(address recipient, uint256 amount) public override returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    /**
     * @notice Override transferFrom function to implement fee logic
     * @param sender The address to transfer from
     * @param recipient The address to transfer to
     * @param amount The amount to transfer
     */
    function transferFrom(address sender, address recipient, uint256 amount) public override returns (bool) {
        address spender = _msgSender(); // Use _msgSender() instead of msg.sender
        _spendAllowance(sender, spender, amount); // Use OpenZeppelin's internal _spendAllowance
        _transfer(sender, recipient, amount);
        return true;
    }

    /**
     * @notice Returns fee structure information
     * @dev Useful for frontends to avoid hardcoding fee values
     * @return totalFee Total fee percentage in basis points (e.g., 300 = 3%)
     * @return devFee Developer fee percentage in basis points
     * @return burnerFee Burner fee percentage in basis points
     * @return denominator Fee denominator (10000 = 100%)
     */
    function getFeeStructure() external view returns (
        uint256 totalFee,
        uint256 devFee,
        uint256 burnerFee,
        uint256 denominator
    ) {
        return (_totalFee, _devFee, _burnerFee, FEE_DENOMINATOR);
    }
    
    /**
     * @notice Returns information about the token cap and current supply
     * @dev Useful for monitoring token cap limits
     * @return cap Maximum token supply cap
     * @return currentSupply Current total supply
     * @return remaining Amount that can still be minted
     * @return percentFilled Percentage of cap filled (0-10000)
     */
    function getCapInfo() external view returns (
        uint256 cap,
        uint256 currentSupply,
        uint256 remaining,
        uint256 percentFilled
    ) {
        currentSupply = totalSupply();
        return (
            CAP,
            currentSupply,
            currentSupply >= CAP ? 0 : CAP - currentSupply,
            currentSupply * FEE_DENOMINATOR / CAP
        );
    }
    
    /**
     * @notice Returns the list of fee-exempt addresses
     * @dev Useful for transparency and verification
     * @return addresses Array of all fee-exempt addresses
     */
    function getFeeExemptAddresses() external view returns (address[] memory addresses) {
        return feeExemptAddresses;
    }
    
    /**
     * @notice Returns the list of current minter addresses
     * @dev Useful for transparency and verification
     * @return addresses Array of all minter addresses
     */
    function getMinters() external view returns (address[] memory addresses) {
        return _minterAddresses;
    }
    
    /**
     * @notice Returns the contract's configuration status
     * @dev Useful for frontends to check token status at a glance
     * @return isTrading Whether trading is enabled
     * @return exemptCount Number of fee-exempt addresses
     * @return hasBurnerVault Whether burner vault is properly set
     * @return minterCount Number of active minters
     */
    function getTokenStatus() external view returns (
        bool isTrading,
        uint256 exemptCount,
        bool hasBurnerVault,
        uint256 minterCount
    ) {
        return (
            tradingEnabled,
            feeExemptCount,
            burnerVault != address(0),
            _minterCount
        );
    }

    function _burn(address account, uint256 amount) internal virtual override {
        super._burn(account, amount);
    }

    function _mint(address account, uint256 amount) internal virtual override(ERC20, ERC20Capped) {
        super._mint(account, amount);
    }

    /**
     * @notice Transfer tokens with fee handling
     * @param _from Address sending tokens
     * @param _to Address receiving tokens
     * @param _amount Amount of tokens to transfer
     */
    function _transfer(
        address _from,
        address _to,
        uint256 _amount
    ) internal virtual override {
        if (_from == address(0)) revert Sparx__ZeroAddress();
        if (_to == address(0)) revert Sparx__ZeroAddress(); // Re-enable check for standard transfers
        if (_amount == 0) revert Sparx__ZeroAmount();

        // Check if trading is enabled for non-exempt addresses
        if (!tradingEnabled && !isFeeExempt[_from] && !isFeeExempt[_to]) {
            revert Sparx__TradingNotEnabled();
        }

        // Handle fees if neither address is exempt
        if (!isFeeExempt[_from] && !isFeeExempt[_to]) {
            uint256 burnFee = (_amount * _burnerFee) / FEE_DENOMINATOR;
            uint256 devTreasuryFee = (_amount * _devFee) / FEE_DENOMINATOR;
            uint256 totalFeeAmount = burnFee + devTreasuryFee;

            // Check if sender has enough balance to cover transfer + fees
            if (balanceOf(_from) < _amount) {
                revert Sparx__InsufficientBalance(_from, balanceOf(_from), _amount);
            }

            // Transfer fees
            super._transfer(_from, burnerVault, burnFee);
            super._transfer(_from, devTreasury, devTreasuryFee);
            emit FeeTransferred(_from, burnerVault, burnFee, false);
            emit FeeTransferred(_from, devTreasury, devTreasuryFee, true);

            // Transfer requested amount minus fees
            super._transfer(_from, _to, _amount - totalFeeAmount);
        } else {
            // No fees for exempt addresses
            if (balanceOf(_from) < _amount) {
                revert Sparx__InsufficientBalance(_from, balanceOf(_from), _amount);
            }
            super._transfer(_from, _to, _amount);
        }
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @notice Update fee percentages
     * @dev Can only be called by owner (DEFAULT_ADMIN_ROLE)
     * @param newDevFee New developer fee in basis points (e.g., 100 = 1%)
     * @param newBurnerFee New burner fee in basis points (e.g., 200 = 2%)
     */
    function setFees(uint256 newDevFee, uint256 newBurnerFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Validate fee values
        uint256 newTotalFee = newDevFee + newBurnerFee;
        if (newTotalFee > 1000) revert SparxToken__InvalidFeeValues(); // Max 10% total fee
        
        _devFee = newDevFee;
        _burnerFee = newBurnerFee;
        _totalFee = newTotalFee;
        
        emit FeesUpdated(newDevFee, newBurnerFee, newTotalFee);
    }

    /**
     * @dev Hook that is called after any transfer of tokens.
     * This includes minting and burning.
     * We override it here to emit a unified SparxBurned event.
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._afterTokenTransfer(from, to, amount); // Call the parent hook

        // Emit SparxBurned event if tokens were sent to the zero address (burned)
        if (to == address(0)) {
            emit SparxBurned(from, amount);
        }
    }

    /**
     * @notice Allows a user to burn their own tokens.
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
} 