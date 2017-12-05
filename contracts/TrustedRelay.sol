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
  uint public fee;
  uint public chainId = 1;
  mapping (address => bool) owners;
  mapping (address => mapping(address => uint)) balances;
  // Maps originating chain id and token address to new address. This requires
  // tokens be recreated on this chain before any such mappings can occur.
  mapping (uint => mapping(address => address)) tokens;
  // An outside token that maps to ether given a chainId. A value of 0 indicates
  // there is no eth token on that chain.
  mapping (uint => address) ethToken;
  // whether ether is allowed on this chain for deposits. This would be true
  // if this is a child chain that maps to an ERC20 token on another chain.
  bool public etherAllowed;

  event Deposit(address indexed sender, address indexed token, uint indexed toChain, uint amount, uint timestamp);
  event UndoDeposit(address indexed sender, address indexed token, uint indexed toChain, uint amount, uint timestamp);
  event RelayedDeposit(address indexed sender, address indexed oldToken, address newToken, uint indexed fromChain, uint amount, uint timestamp);

  event NewOwner(address newOwner, uint timestamp);
  event RemoveOwner(address oldOwner, uint timestamp);

  function TrustedRelay() public {
    owners[msg.sender] = true;
    NewOwner(msg.sender, now);
  }

  function addOwner(address newOwner) public isOwner {
    owners[newOwner] = true;
    NewOwner(newOwner, now);
  }

  function removeOwner(address oldOwner) public isOwner {
    owners[oldOwner] = false;
    RemoveOwner(oldOwner, now);
  }

  function changeFee(uint newFee) public isOwner {
    fee = newFee;
  }

  function changeEtherAllowed(bool allowed) public isOwner {
    etherAllowed = allowed;
  }

  // Make a deposit to another chain. This locks up the tokens on this chain.
  // They will appear in the other chain for withdrawal.
  // Note that the user must pay exactly the fee
  function depositERC20(bytes32 m, uint8 v, bytes32 r, bytes32 s, address token, uint amount, uint[2] chainIds)
  public payable {
    address sender = makeChecks(m, v, r, s, [token, msg.sender], amount, chainIds);
    Token t;
    t = Token(token);
    t.transfer(address(this), amount);
    address(this).transfer(msg.value);
    Deposit(sender, token, chainIds[1], amount, now);
  }

  // This may map to an eth token on a different chain. If it doesn't, the call
  // will fail on the other end.
  function depositEther(bytes32 m, uint8 v, bytes32 r, bytes32 s, uint[2] chainIds)
  public payable {
    assert(etherAllowed == true);
    assert(msg.value > 0);
    // Make sure there is an ether token on the desired chain
    assert(ethToken[chainIds[1]] != address(0));
    address sender = makeChecks(m, v, r, s, [address(0), msg.sender], msg.value, chainIds);
    Deposit(sender, address(0), chainIds[1], msg.value, now);
  }

  // Relayer only
  // Unfreeze tokens on this chain.
  // addrs = [ token, originalSender ]
  function relayDepositERC20(bytes32 m, uint8 v, bytes32 r, bytes32 s, address[2] addrs, uint amount, uint[2] chainIds)
  isOwner public {
    address sender = makeChecks(m, v, r, s, addrs, amount, chainIds);
    if (ethToken[chainIds[0]] == addrs[0]) {
      // If this is an eth token, reward ether on this chain
      sender.transfer(amount);
      RelayedDeposit(sender, addrs[0], address(0), chainIds[0], amount, now);
    } else {
      // Otherwise reward a token
      Token t;
      t = Token(tokens[chainIds[0]][addrs[0]]);
      assert(t.balanceOf(address(this)) >= amount);
      t.transfer(sender, amount);
      RelayedDeposit(sender, addrs[0], tokens[chainIds[0]][addrs[0]], chainIds[0], amount, now);
    }
  }

  // If there is not a matching token on the other chain or some other error
  // occurred, the relayer can bring it back to this chain.
  // addrs = [ token, originalSender ]
  function undoDepositERC20(bytes32 m, uint8 v, bytes32 r, bytes32 s, address[2] addrs, uint amount, uint[2] chainIds)
  isOwner public {
    address sender = makeChecks(m, v, r, s, addrs, amount, chainIds);
    Token t;
    t = Token(addrs[0]);
    t.transfer(sender, amount);
    UndoDeposit(sender, addrs[0], chainIds[1], amount, now);
  }

  // Recreate a new token based on the parameters of the old one. This new token
  // only has basic ERC20 functionality and all tokens will be owned by this contract.
  // Anyone that deposits into the old chain will get an equivalent number of this
  // token withdrawn to their address in this chain by the relayer.
  function recreateERC20Token(address oldToken, uint oldChainId, uint256 initialAmount, string tokenName, uint8 decimalUnits, string tokenSymbol)
  isOwner public {
    HumanStandardToken newToken = new HumanStandardToken(initialAmount, tokenName, decimalUnits, tokenSymbol);
    tokens[oldChainId][oldToken] = newToken;
  }

  // This is for more complicated tokens with additional functionality. They must
  // be recreated before this can be called. It associates an old chain address
  // with this new token.
  function mapERC20Token(uint oldChainId, address oldToken, address newToken) public isOwner {
    tokens[oldChainId][oldToken] = newToken;
  }


  function makeChecks(bytes32 m, uint8 v, bytes32 r, bytes32 s, address[2] addrs, uint amount, uint[2] chainIds)
  public constant returns(address) {
    address sender = hashChecks(m, v, r, s, addrs, amount, chainIds);
    address mappedToken = tokens[chainIds[0]][addrs[1]];
    assert(mappedToken != address(0));
    return sender;
  }

  function hashChecks(bytes32 m, uint8 v, bytes32 r, bytes32 s, address[2] addrs, uint amount, uint[2] chainIds)
  public constant returns(address) {
    assert(m == keccak256(chainIds[0], chainIds[1], addrs[0], amount, addrs[1]));
    assert(chainIds[0] == chainId);
    address sender = ecrecover(m, v, r, s);
    assert(addrs[1] == sender);
    return sender;
  }


  modifier isOwner() {
    assert(owners[msg.sender] == true);
    _;
  }

}
