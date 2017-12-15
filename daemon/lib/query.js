// Query Ethereum provider for information
const zeroAddr = '0x0000000000000000000000000000000000000000';
const tokenAbi = require('../../build/contracts/HumanStandardToken.json').abi;
const tokenBytes = require('../../build/contracts/HumanStandardToken.json').bytecode;
let sender;

function setSender(_sender) { sender = _sender;}

function relayMessage(msg, contract) {
  return new Promise((resolve, reject) => {
    contract.methods.relayDeposit(msg.sig.m, msg.sig.v, msg.sig.r, msg.sig.s,
      [msg.oldToken, msg.sender], msg.amount, msg.fromChain, [msg.fee, msg.timestamp])
      .send({ from: sender, gas: 500000 })
      .then((receipt) => { return resolve(receipt); })
      .catch((err) => { return reject(err); })
  })
}


// Given a transaction hash, query the input. The first four words (256 bits each)
// will be hash, v, r, s (see: TrustedRelay.sol::depositERC20)
function getSig(txHash, web3) {
  return new Promise((resolve, reject) => {
    console.log('getting tx')
    web3.eth.getTransaction(txHash)
    .then((tx) => {
      // Slice off the 0x and first 4 bytes (abi signature)
      const input = tx.input.slice(10);
      let sig = {
        m: `0x${input.substr(0, 64)}`,
        v: parseInt(input.substr(64, 64), 16),
        r: `0x${input.substr(128, 64)}`,
        s: `0x${input.substr(192, 64)}`
      }
      return resolve(sig);
    })
    .catch((err) => { return reject(err); })
  })
}

function findTokenMapping(fromChain, fromToken, contract) {
  return new Promise((resolve, reject) => {
    console.log('findTokenMapping')
    contract.methods.getTokenMapping(fromChain, fromToken).call({}, (err, res) => {
      if (err) { return reject(err); }
      if (res == zeroAddr) { return resolve(null); }
      return resolve(res);
    });
  })
}

// Get metadata for token
function getToken(addr, web3) {
  return new Promise((resolve, reject) => {
    let tokenData = {};
    const token = new web3.eth.Contract(tokenAbi, addr.toLowerCase());
    tokenData.addr = token.options.address;
    token.methods.decimals().call({ from: sender }, (err, decimals) => {
      if (err) return reject(err);
      tokenData.decimals = decimals;
      token.methods.totalSupply().call({ from: sender }, (err, totalSupply) => {
        if (err) { return reject(err); }
        tokenData.totalSupply = totalSupply;
        token.methods.symbol().call({ from: sender }, (err, symbol) => {
          if (err) return reject(err);
          tokenData.symbol = symbol;
          token.methods.name().call({ from: sender }, (err, name) => {
            if (err) return reject(err);
            tokenData.name = name;
            return resolve(tokenData);
          })
        })
      })
    })
  })
}

// Create a new ERC20 token contract with the token params found on the other
// chain. Note that this is NOT the same thing as the code that currently
// exists at the other contract (that contains state data)
function createContract(token, deployer, relayAddr, web3) {
  return new Promise((resolve, reject) => {
    // First get the token data
    const NewToken = new web3.eth.Contract(tokenAbi)
    let newAddr;
    NewToken.deploy({ data: tokenBytes, arguments: [parseInt(token.totalSupply),
      token.name, parseInt(token.decimals), token.symbol] })
      .send({ from: deployer, gas: 4000000 })
      .on((err) => { return reject(err); })
      .then((instance) => {
        newAddr = instance.options.address;
        // Send the entire supply to the relay contract
        instance.methods.transfer(relayAddr, parseInt(token.totalSupply))
          .send({ from: deployer, gas: 100000 })
          .on((err) => { return reject(err); })
          .then(() => { return resolve(newAddr); })
      })
  })
}

function createTokenMapping(oldTokenAddr, newTokenAddr, fromChain, contract) {
  return new Promise((resolve, reject) => {
    contract.methods.mapERC20Token(fromChain, oldTokenAddr, newTokenAddr)
      .send({ from: sender, gas: 300000 })
      .then((receipt) => { return resolve(receipt); })
      .catch((err) => { return reject(err); })
  })
}

exports.getSig = getSig;
exports.relayMessage = relayMessage;
exports.setSender = setSender;
exports.findTokenMapping = findTokenMapping;
exports.getToken = getToken;
exports.createContract = createContract;
exports.createTokenMapping = createTokenMapping;
