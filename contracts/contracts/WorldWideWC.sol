// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title World Wide WC
/// @notice The registry and reward pool behind worldwidewc — a map of public toilets
///         contributed to by humans and AI agents alike.
///
/// The contract deliberately stores almost nothing. Every attribute of a toilet lives in
/// the `payload` of an event and is indexed by our subgraph on The Graph, which is the
/// only read path the app has. What must live onchain is the part money depends on:
/// who contributed, how much weight that earned them, and what they can claim.
///
/// Rewards use the standard pull-based accumulator, so a donation costs the same gas
/// whether there are five contributors or fifty thousand — it never loops over them.
contract WorldWideWC is ERC20, Ownable, ReentrancyGuard {
    /// @notice Weight earned for logging a toilet yourself.
    uint256 public constant WEIGHT_HUMAN_LOG = 10;
    /// @notice Weight earned by an agent-sourced entry. Lower: it is cheaper to produce
    ///         and needs a human to verify it before it is worth as much.
    uint256 public constant WEIGHT_AGENT_LOG = 3;
    /// @notice Weight earned for rating a toilet someone else logged.
    uint256 public constant WEIGHT_RATING = 1;

    /// @notice Address permitted to submit on a contributor's behalf, so contributors
    ///         never need gas. It verifies their signature offchain before relaying.
    address public relayer;

    /// @notice Number of toilets logged; also the id of the most recent one.
    uint256 public toiletCount;

    /// @notice Sum of all contributor weights.
    uint256 public totalWeight;
    /// @notice Whole wei owed per unit of weight, accumulated over every donation.
    uint256 public accPerWeight;
    /// @notice Donated wei not yet distributed: either nobody had weight when it arrived,
    ///         or it is rounding dust. Carried forward, never stranded.
    uint256 public poolPending;
    /// @notice Total ever donated, for the UI.
    uint256 public totalDonated;

    mapping(address contributor => uint256) public weightOf;
    mapping(address contributor => uint256) private rewardDebt;
    mapping(address contributor => uint256) private accrued;
    mapping(address contributor => uint256) public claimedOf;

    event ToiletLogged(
        uint256 indexed id, address indexed contributor, int32 lat, int32 lng, string payload
    );
    event ToiletRated(uint256 indexed id, address indexed rater, string payload);
    event Donated(address indexed donor, uint256 amount, string note);
    event Claimed(address indexed contributor, uint256 amount);
    event RelayerChanged(address indexed relayer);

    error NotRelayer();
    error NoSuchToilet();
    error NothingToClaim();
    error NothingToDonate();
    error TransferFailed();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address initialOwner, address initialRelayer)
        ERC20("World Wide WC", "WC")
        Ownable(initialOwner)
    {
        relayer = initialRelayer;
        emit RelayerChanged(initialRelayer);
    }

    // --- contributing -------------------------------------------------------

    /// @notice Log a toilet on behalf of `contributor`.
    /// @param lat Latitude at 1e6 scale, so 51.504936 is 51504936.
    /// @param lng Longitude at 1e6 scale.
    /// @param payload Compact JSON of the toilet's attributes and its provenance.
    /// @param isAgent True when an agent sourced this from the web rather than a human
    ///        standing in front of it.
    function logFor(
        address contributor,
        int32 lat,
        int32 lng,
        string calldata payload,
        bool isAgent
    ) external onlyRelayer returns (uint256 id) {
        id = ++toiletCount;
        _addWeight(contributor, isAgent ? WEIGHT_AGENT_LOG : WEIGHT_HUMAN_LOG);
        emit ToiletLogged(id, contributor, lat, lng, payload);
    }

    /// @notice Rate an existing toilet on behalf of `rater`.
    function rateFor(uint256 id, address rater, string calldata payload) external onlyRelayer {
        if (id == 0 || id > toiletCount) revert NoSuchToilet();
        _addWeight(rater, WEIGHT_RATING);
        emit ToiletRated(id, rater, payload);
    }

    // --- money in -----------------------------------------------------------

    /// @notice Donate to the toilet cause. Splits across every contributor by weight.
    function donate(string calldata note) external payable {
        if (msg.value == 0) revert NothingToDonate();
        _receiveDonation(msg.value, note);
    }

    /// @notice Plain transfers count as an unnamed donation.
    receive() external payable {
        _receiveDonation(msg.value, "");
    }

    // --- money out ----------------------------------------------------------

    /// @notice Wei `contributor` could claim right now.
    function pendingOf(address contributor) public view returns (uint256) {
        return accrued[contributor] + _unsettled(contributor);
    }

    /// @notice Claim your share of everything donated since you started contributing.
    function claim() external nonReentrant returns (uint256 amount) {
        _settle(msg.sender);
        amount = accrued[msg.sender];
        if (amount == 0) revert NothingToClaim();

        accrued[msg.sender] = 0;
        claimedOf[msg.sender] += amount;
        emit Claimed(msg.sender, amount);

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // --- admin --------------------------------------------------------------

    function setRelayer(address newRelayer) external onlyOwner {
        relayer = newRelayer;
        emit RelayerChanged(newRelayer);
    }

    // --- internals ----------------------------------------------------------

    function _receiveDonation(uint256 amount, string memory note) internal {
        totalDonated += amount;
        poolPending += amount;
        _flushPool();
        emit Donated(msg.sender, amount, note);
    }

    /// @dev Moves whatever of `poolPending` divides evenly across the current weight into
    ///      the accumulator, and keeps the remainder pending for the next flush.
    ///
    ///      Deliberately integer wei per unit of weight rather than a scaled fixed-point
    ///      accumulator: it makes a contributor's entitlement `weight * accPerWeight`, a
    ///      plain multiplication with no division to truncate. Every wei donated is
    ///      therefore either owed to someone or still pending — never conjured, never
    ///      stranded. A fixed-point version of this leaked a wei per flush, which the
    ///      conservation test caught.
    function _flushPool() internal {
        if (totalWeight == 0 || poolPending == 0) return;
        uint256 share = poolPending / totalWeight;
        if (share == 0) return; // smaller than a wei each; wait for the pool to grow
        accPerWeight += share;
        poolPending -= share * totalWeight;
    }

    function _unsettled(address contributor) internal view returns (uint256) {
        return weightOf[contributor] * accPerWeight - rewardDebt[contributor];
    }

    function _settle(address contributor) internal {
        accrued[contributor] += _unsettled(contributor);
        rewardDebt[contributor] = weightOf[contributor] * accPerWeight;
    }

    /// @dev Flushes first, so a donation made before someone arrived is not diluted by
    ///      their arrival. Mints WC 1:1 with weight, so contributors see coins in a wallet.
    function _addWeight(address contributor, uint256 weight) internal {
        _flushPool();
        _settle(contributor);

        weightOf[contributor] += weight;
        totalWeight += weight;
        rewardDebt[contributor] = weightOf[contributor] * accPerWeight;

        _mint(contributor, weight * 1e18);
        _flushPool();
    }
}
