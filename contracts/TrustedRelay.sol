// NOTE: THIS IS NOT YET FUNCTIONAL!!!

// This is a proof-of-concept of a token relay between chains.
// A user deposits tokens to this contract and chooses the destination chain.
// The relayer is incentivized with a small fee to replay the message on the
// desired chain.
// A separate chain must have a token that maps 1:1 to the current chain.
// In the case of a new chain, the relayer contract would initially own all
// the tokens (but they would be locked up).
pragma solidity ^0.4.18;

import "tokens/Token.sol";  // truffle package (install with `truffle install tokens`)
import "tokens/HumanStandardToken.sol";

contract TrustedRelay {

  //============================================================================
  // GLOBAL VARIABLES
  //============================================================================

  bool public killswitch;
  // Number of seconds worth of difference we will "tolerate" the default is
  // 10 minutes. If a message is sent that is >tolerance old, it will be rejected.
  uint public tolerance = 600;
  mapping (address => bool) owners;
  mapping (address => mapping(address => uint)) balances;
  // Maps originating chain id and token address to new address. This requires
  // tokens be recreated on this chain before any such mappings can occur.
  mapping (address => mapping(address => address)) tokens;
  // An outside token that maps to ether given a chainId. A value of 0 indicates
  // there is no eth token on that chain.
  mapping (address => address) ethTokens;
  // whether ether is allowed on this chain for deposits. This would be true
  // if this is a child chain that maps to an ERC20 token on another chain.
  bool public etherAllowed;
  // Multiplier that can resolve conflicts in decimals.
  mapping (address => uint) ethMultipliers;
  // If any deposits fail and need to be undone, that can only be done once.
  // They are identified by the hash that is signed to deposit in the first place.
  mapping (bytes32 => bool) undone;
  // To prevent replays, record when a deposit happens and when a relay happens.
  mapping (bytes32 => bool) played;

  //============================================================================
  // EVENTS AND INIT
  //============================================================================

  event Deposit(address indexed sender, address indexed token, address indexed toChain,
    uint amount, uint fee, uint tsIncl, uint tsNow);
  event UndoDeposit(address indexed sender, address indexed token, address indexed toChain,
    address relayer, uint amount, uint fee, uint tsIncl, uint tsNow);
  event RelayedDeposit(address indexed sender, address indexed newToken,
    address indexed fromChain, address oldToken, uint amount, uint fee, uint tsIncl, uint tsNow);

  event NewOwner(address newOwner, uint timestamp);
  event RemoveOwner(address oldOwner, uint timestamp);

  function TrustedRelay() public {
    owners[msg.sender] = true;
    killswitch = false;
    NewOwner(msg.sender, now);
  }

  // Depositing ether
  function () payable {
    assert(etherAllowed == true);
  }

  //============================================================================
  // DEPOSITS AND RELAYS
  //============================================================================

  // Make a deposit to another chain. This locks up the tokens on this chain.
  // They will appear in the other chain for withdrawal.
  // data = [ fee, timestamp ]
  function depositERC20(bytes32 m, uint8 v, bytes32 r, bytes32 s, address token, uint amount, address toChain, uint[2] data)
  public payable noKill notPlayed(m) {
    /*assert(data[1] >= now && data[1] - now < tolerance); // check timestamp*/
    address sender = hashChecks(m, v, r, s, [token, msg.sender], amount, [address(this), toChain], data, false);
    assert(sender == msg.sender);
    Token t;
    t = Token(token);
    t.transferFrom(sender, address(this), amount);
    Deposit(sender, token, toChain, amount, data[0], data[1], now);
    played[m] = true;
  }

  // This may map to an eth token on a different chain. If it doesn't, the call
  // will fail on the other end.
  // NOTE: The `amount` in the message is msg.value/multiplier. This is so that it
  // can map to the correct amount of ERC20 tokens on the other side.
  // chainIds = [ originating, destination]
  // data = [ fee, timestamp ]
  function depositEther(bytes32 m, uint8 v, bytes32 r, bytes32 s, address toChain, uint[2] data)
  public payable noKill notPlayed(m) {
    played[m] = true;
    assert(data[1] >= now && data[1] - now < tolerance); // check timestamp
    assert(etherAllowed == true);
    assert(msg.value > 0);
    // Make sure there is an ether token on the desired chain
    assert(ethTokens[toChain] != address(0));
    uint amount = msg.value / ethMultipliers[toChain];
    address sender = hashChecks(m, v, r, s, [address(0), msg.sender], amount, [address(this), toChain], data, false);
    assert(sender == msg.sender);
    Deposit(sender, address(0), toChain, msg.value, data[0], data[1], now);
  }

  // Relay a signed message (deposit). This can be called by any address, but must
  // contain signatures from both the user and an owner (i.e. a relayer).
  // v, r, s -> [0] = user, [1] = relayer
  // addrs = [ token, originalSender ]
  // data = [ fee, timestamp ]
  function relayDeposit(bytes32 m, uint8[2] v, bytes32[2] r, bytes32[2] s, address[2] addrs, uint amount, address fromChain, uint[2] data)
  isOwner public notPlayed(m) {
    played[m] = true;
    address sender = hashChecks(m, v[0], r[0], s[0], addrs, amount, [fromChain, address(this)], data, false);
    address relayer = hashChecks(m, v[1], r[1], s[1], addrs, amount, [fromChain, address(this)], data, false);
    assert(sender == addrs[1]);
    assert(owners[relayer] == true);
    if (ethTokens[fromChain] == addrs[0] && address(addrs[0]) != address(0)) {
      // If this is an eth token, reward ether on this chain
      sender.transfer(ethMultipliers[fromChain] * (amount-data[0]));
      msg.sender.transfer(ethMultipliers[fromChain] * data[0]);
      RelayedDeposit(sender, address(0), fromChain, addrs[0], amount, data[0], data[1], now);
    } else {
      require(tokens[fromChain][addrs[0]] != address(0));
      // Otherwise reward a token
      Token t;
      t = Token(tokens[fromChain][addrs[0]]);
      assert(t.balanceOf(address(this)) >= amount);
      t.transfer(sender, amount-data[0]);
      t.transfer(msg.sender, data[0]);
      RelayedDeposit(sender, tokens[fromChain][addrs[0]], fromChain, addrs[0], amount, data[0], data[1], now);
    }
  }

  // If there is not a matching token on the other chain or some other error
  // occurred, the deposit can be undone. This can also be done if the relayer
  // doesn't want to pay the gas to relay the message onto the other chain.
  //
  // This function can be called by any actor on the network with the right data.
  //
  // sig = [ hash, undoHash, sender_r, sender_s, relayer_r, relayer_s ]
  // v = [ sender_v, relayer_v ]
  // addrs = [ token, originalSender ]
  // sig = [ hash, r, s ]
  // data = [ fee, timestamp ]
  function undoDeposit(bytes32[6] sig, uint8[2] v, address[2] addrs, uint amount, address toChain, uint[2] data) public {
    assert(played[sig[0]] == true);
    assert(undone[sig[0]] == false);
    undone[sig[0]] = true;
    address sender = hashChecks(sig[1], v[0], sig[2], sig[3], addrs, amount, [address(this), toChain], data, true);
    address relayer = hashChecks(sig[1], v[1], sig[4], sig[5], addrs, amount, [address(this), toChain], data, true);
    assert(owners[relayer] == true);
    if (addrs[0] == address(0)) {
      sender.transfer(amount);
    } else {
      Token t;
      t = Token(addrs[0]);
      t.transfer(sender, amount);
    }
    UndoDeposit(sender, addrs[0], toChain, relayer, amount, data[0], data[1], now);
  }


  //============================================================================
  // OWNER ADMIN FUNCTIONS
  //============================================================================

  function addOwner(address newOwner) public isOwner {
    owners[newOwner] = true;
    NewOwner(newOwner, now);
  }

  function removeOwner(address oldOwner) public isOwner {
    owners[oldOwner] = false;
    RemoveOwner(oldOwner, now);
  }

  function changeEtherAllowed(bool allowed) public isOwner {
    etherAllowed = allowed;
  }

  function setTolerance(uint newTolerance) public isOwner {
    tolerance = newTolerance;
  }

  function flipKillSwitch(bool kill) public isOwner {
    killswitch = kill;
  }

  function mapERC20Token(address oldChainId, address oldToken, address newToken) public isOwner {
    assert(tokens[oldChainId][oldToken] == address(0));
    tokens[oldChainId][oldToken] = newToken;
  }

  function mapEthToken(address fromChain, address originToken) public isOwner {
    assert(ethTokens[fromChain] == address(0));
    ethTokens[fromChain] = originToken;
  }

  function setEthMultiplier(address fromChain, uint multiplier) public isOwner {
    assert(ethTokens[fromChain] != address(0));
    assert(ethMultipliers[fromChain] == uint(0));
    ethMultipliers[fromChain] = multiplier;
  }



  //============================================================================
  // CONSTANT FUNCTIONS
  //============================================================================

  function hashChecks(bytes32 m, uint8 v, bytes32 r, bytes32 s, address[2] addrs,
    uint amount, address[2] chainIds, uint[2] data, bool undo)
  public constant returns(address) {
    // Order of items:
    // <originating chainId>, <destination chainId>,
    // <originating token address>, <depositer address>
    // <amount of token deposited (atomic units)>,
    // <fee>, <timestamp>
    bytes memory prefix = "\x19Ethereum Signed Message:\n176";
    if (undo) {
      assert(true == true);
      /*assert(m == keccak256(prefix, chainIds[0], chainIds[1], addrs[0], amount, addrs[1], data[0], data[1], uint(1)));*/
    } else {
      assert(m == keccak256(prefix, chainIds[0], chainIds[1], addrs[0], amount, addrs[1], data[0], data[1]));
    }
    assert(chainIds[0] == address(this) || chainIds[1] == address(this));
    address sender = ecrecover(m, v, r, s);
    return sender;
  }

  function checkIsOwner(address owner) public constant returns (bool) {
    if (owners[owner] == true) { return true; }
    return false;
  }

  function getNow() public constant returns (uint) {
    return now;
  }

  function getTokenMapping(address fromChain, address token) public constant returns (address) {
    return tokens[fromChain][token];
  }

  function getEthTokenMapping(address fromChain) public constant returns (address) {
    return ethTokens[fromChain];
  }

  function getEthMultiplier(address fromChain) public constant returns (uint) {
    return ethMultipliers[fromChain];
  }

  modifier isOwner() {
    assert(owners[msg.sender] == true);
    _;
  }

  modifier noKill() {
    assert(killswitch == false);
    _;
  }

  modifier notPlayed(bytes32 m) {
    assert(played[m] == false);
    _;
  }

}
