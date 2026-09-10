// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

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
/// There is no token here. Weight is the whole accounting: it is what the pool pays
/// against, and a contributor's share of every donation is their weight over the total.
/// An earlier version also minted an ERC-20 one-for-one with weight, which was a second
/// name for the same number — and a dangerous one, because the token transferred while
/// the weight behind it did not. Selling it would have moved nothing.
///
/// Rewards use the standard pull-based accumulator, so a donation costs the same gas
/// whether there are five contributors or fifty thousand — it never loops over them.
contract WorldWideWC is Ownable, ReentrancyGuard {
    /// @notice Weight earned for logging a toilet yourself.
    uint256 public constant WEIGHT_HUMAN_LOG = 10;
    /// @notice Weight earned by an agent-sourced entry. Lower: it is cheaper to produce
    ///         and needs a human to verify it before it is worth as much.
    uint256 public constant WEIGHT_AGENT_LOG = 3;
    /// @notice Weight earned for rating a toilet someone else logged.
    uint256 public constant WEIGHT_RATING = 1;

    /// @notice Bonus weight when a judge finds the source fresh and corroborating. Takes
    ///         an agent entry from 3 to 10 — exactly human parity. An entry starts low
    ///         because nobody checked it; proving the source is how it earns the rest.
    uint256 public constant WEIGHT_VERIFIED_HIGH = 7;
    /// @notice Bonus when the source is valid but stale.
    uint256 public constant WEIGHT_VERIFIED_MEDIUM = 2;

    uint8 public constant SCORE_HIGH = 80;
    uint8 public constant SCORE_MEDIUM = 40;

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

    /// @notice Who logged each toilet. Needed to pay a verification bonus to the right
    ///         person; previously this only ever existed in an event.
    mapping(uint256 toiletId => address) public contributorOf;
    /// @notice The judge's most recent score, 0-100.
    mapping(uint256 toiletId => uint8) public verificationOf;
    /// @notice Bonus weight already granted for this toilet, so re-verifying pays only
    ///         the difference and the same evidence cannot be farmed twice.
    mapping(uint256 toiletId => uint256) public bonusOf;

    event ToiletLogged(
        uint256 indexed id,
        address indexed contributor,
        int32 lat,
        int32 lng,
        bool isAgent,
        string payload
    );
    event ToiletRated(uint256 indexed id, address indexed rater, string payload);
    event ToiletVerified(
        uint256 indexed id, address indexed contributor, uint8 score, uint256 bonus, string evidence
    );
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

    constructor(address initialOwner, address initialRelayer) Ownable(initialOwner) {
        relayer = initialRelayer;
        emit RelayerChanged(initialRelayer);
    }

    // --- contributing -------------------------------------------------------

    /// @notice Log a toilet, paying your own gas.
    /// @param lat Latitude at 1e6 scale, so 51.504936 is 51504936.
    /// @param lng Longitude at 1e6 scale.
    /// @param payload Compact JSON of the toilet's attributes and its provenance.
    /// @param isAgent Declare true if software sourced this rather than a person standing
    ///        in front of it. Third-party agents are expected to use this path.
    ///
    /// Provenance is self-declared, and that is safe because it costs you to be honest in
    /// the only direction anyone would cheat: an agent entry is worth 3 weight, a human
    /// one 10. Nobody lies their way into a smaller reward. Claiming to be human when you
    /// are software is the lie worth telling, and that is the one the map's readers can
    /// catch, because an agent entry without a working source URL is visibly worthless.
    ///
    /// This path needs no server at all: the contract credits `msg.sender`, so there is
    /// nobody to trust in between. Anyone with a wallet and some gas can add to this map
    /// even if every server we run disappears.
    function log(int32 lat, int32 lng, string calldata payload, bool isAgent)
        external
        returns (uint256 id)
    {
        return _log(msg.sender, lat, lng, payload, isAgent);
    }

    /// @notice Rate an existing toilet, paying your own gas.
    function rate(uint256 id, string calldata payload) external {
        _rate(id, msg.sender, payload);
    }

    /// @notice Log a toilet on behalf of `contributor`, who signed for it offchain.
    /// @param isAgent True when an agent sourced this from the web rather than a human
    ///        standing in front of it.
    ///
    /// The relayer pays the gas so a contributor never has to hold ETH. It cannot pay
    /// itself: every function it can call is non-payable, and the reward pool is reachable
    /// only through donate() and claim().
    function logFor(
        address contributor,
        int32 lat,
        int32 lng,
        string calldata payload,
        bool isAgent
    ) external onlyRelayer returns (uint256 id) {
        return _log(contributor, lat, lng, payload, isAgent);
    }

    /// @notice Rate an existing toilet on behalf of `rater`, who signed for it offchain.
    function rateFor(uint256 id, address rater, string calldata payload) external onlyRelayer {
        _rate(id, rater, payload);
    }

    function _log(
        address contributor,
        int32 lat,
        int32 lng,
        string calldata payload,
        bool isAgent
    ) internal returns (uint256 id) {
        id = ++toiletCount;
        contributorOf[id] = contributor;
        _addWeight(contributor, isAgent ? WEIGHT_AGENT_LOG : WEIGHT_HUMAN_LOG);
        emit ToiletLogged(id, contributor, lat, lng, isAgent, payload);
    }

    function _rate(uint256 id, address rater, string calldata payload) internal {
        if (id == 0 || id > toiletCount) revert NoSuchToilet();
        _addWeight(rater, WEIGHT_RATING);
        emit ToiletRated(id, rater, payload);
    }

    /// @notice Record a judge's verdict on the source behind a toilet, and pay the
    ///         contributor the weight that verdict earns them.
    /// @param score 0-100. Below 40 earns nothing; 40-79 is a stale but valid source;
    ///        80 and above is fresh and corroborating.
    /// @param evidence A short, human-readable justification. It goes onchain precisely
    ///        so every verdict is publicly auditable — the judge is relayer-gated, which
    ///        is a real centralisation point, and this is what keeps it answerable.
    ///
    /// Only ever pays the difference between what this score earns and what has already
    /// been granted, and never takes weight away. That keeps `_addWeight` increase-only,
    /// so the reward accumulator needs no special handling and nobody can lose ETH they
    /// have already accrued because a judge changed its mind.
    function verify(uint256 id, uint8 score, string calldata evidence) external onlyRelayer {
        if (id == 0 || id > toiletCount) revert NoSuchToilet();

        uint256 earned =
            score >= SCORE_HIGH ? WEIGHT_VERIFIED_HIGH : score >= SCORE_MEDIUM ? WEIGHT_VERIFIED_MEDIUM : 0;
        uint256 already = bonusOf[id];

        verificationOf[id] = score;

        uint256 bonus = 0;
        if (earned > already) {
            bonus = earned - already;
            bonusOf[id] = earned;
            _addWeight(contributorOf[id], bonus);
        }

        emit ToiletVerified(id, contributorOf[id], score, bonus, evidence);
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
    ///      their arrival, and again afterwards because the larger total may now divide a
    ///      remainder that previously could not be shared out.
    function _addWeight(address contributor, uint256 weight) internal {
        _flushPool();
        _settle(contributor);

        weightOf[contributor] += weight;
        totalWeight += weight;
        rewardDebt[contributor] = weightOf[contributor] * accPerWeight;

        _flushPool();
    }
}
