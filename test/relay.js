/* eslint-env mocha */
/* global artifacts assert contract */

const bip39 = require('bip39');
const hdkey = require('ethereumjs-wallet/hdkey');
const leftPad = require('left-pad');
const secrets = require('../secrets.json');
const sha3 = require('solidity-sha3').default;
const util = require('ethereumjs-util');
const truffleConf = require('../truffle.js').networks;
const Web3 = require('web3');

const provider = `http://${truffleConf.devChild.host}:${truffleConf.devChild.port}`;
const web3 = new Web3(new Web3.providers.HttpProvider(provider));

const relayABI = require('../build/contracts/TrustedRelay.json').abi;
const relayBytes = require('../build/contracts/TrustedRelay.json').bytecode;
const tokenABI = require('../build/contracts/HumanStandardToken.json').abi;
const tokenBytes = require('../build/contracts/HumanStandardToken.json').bytecode;

const Token = artifacts.require('HumanStandardToken.sol'); // EPM package
const TrustedRelay = artifacts.require('./TrustedRelay');


let parentRelay = null;
let parentToken = null;
let childRelay = null;
let childToken = null;

// const ethQuery = new EthQuery(new HttpProvider('http://localhost:7545'));
let wallets = [];

contract('TrustedRelay', (accounts) => {
  assert(accounts.length > 0);

  function generateFirstWallets(n, _wallets, hdPathIndex) {
    const hdwallet = hdkey.fromMasterSeed(bip39.mnemonicToSeed(secrets.mnemonic));
    const node = hdwallet.derivePath(secrets.hdPath + hdPathIndex.toString());
    const secretKey = node.getWallet().getPrivateKeyString();
    const addr = node.getWallet().getAddressString();
    _wallets.push([addr, secretKey]);
    const nextHDPathIndex = hdPathIndex + 1;
    if (nextHDPathIndex >= n) {
      return _wallets;
    }
    return generateFirstWallets(n, _wallets, nextHDPathIndex);
  }

  // Get signature on a piece of data
  function sign(msg, wallet) {
    const msgBuf = Buffer.from(msg.slice(2), 'hex');
    const pkey = Buffer.from(wallet[1].slice(2), 'hex');
    const sig = util.ecsign(msgBuf, pkey);
    const newSig = {
      r: `0x${leftPad(sig.r.toString('hex'), 64, '0')}`,
      s: `0x${leftPad(sig.s.toString('hex'), 64, '0')}`,
      v: sig.v,
    };
    return newSig;
  }

  // <originating chainId>, <destination chainId>, <originating token address>,
  // <amount of token deposited (atomic units)>, <depositer address>,
  // <fee>, <timestamp>
  function hashData(data) {
    // NOTE: Solidity tightly packs addresses as 20-byte strings. Everything else
    // is packed as a 32 byte string. This is a weird idiosyncracy.
    const a = leftPad(data.origChain.toString(16), 64, '0');
    const b = leftPad(data.destChain.toString(16), 64, '0');
    const c = data.token.slice(2);
    const d = leftPad(data.amount.toString(16), 64, '0');
    const e = data.sender.slice(2);
    const f = leftPad(data.fee.toString(16), 64, '0');
    const g = leftPad(data.ts.toString(16), 64, '0');
    return sha3(`0x${a}${b}${c}${d}${e}${f}${g}`);
  }


  // function isEVMException(err) {
  //   return err.toString().includes('VM Exception');
  // }
  describe('Origin chain', () => {
    it('should make sure the owner is accounts[0].', async () => {
      parentRelay = await TrustedRelay.deployed();
      const isOwner = await parentRelay.checkIsOwner(accounts[0]);
      assert(isOwner === true);
    });

    it('should set chainId to 1.', async () => {
      await parentRelay.setChainId(1, { from: accounts[0] });
      const chainId = await parentRelay.chainId();
      assert(chainId.toString() === '1');
    });

    it('should create a new token on the main chain and set approval.', async () => {
      parentToken = await Token.new(1000, 'Token', 0, 'TKN', { from: accounts[1] });
      const userBal = await parentToken.balanceOf(accounts[1]);
      assert(userBal.toString() === '1000');
      await parentToken.approve(parentRelay.address, 100, { from: accounts[1] });
      const approval = await parentToken.allowance(accounts[1], parentRelay.address);
      assert(approval.toString() === '100');
    });

    it('should generate two wallets for accounts[0] and accounts[1].', async () => {
      wallets = generateFirstWallets(2, [], 0);
      assert(wallets.length === 2);
    });

    it('should deposit 100 tokens to the relay.', async () => {
      const d = {
        origChain: 1,
        destChain: 2,
        token: parentToken.address,
        amount: 100,
        sender: accounts[1],
        fee: 0,
        ts: null,
      };
      const now = await parentRelay.getNow();
      d.ts = parseInt(now.toString(), 10);
      const hash = hashData(d);
      const sig = sign(hash, wallets[1]);
      await parentRelay.depositERC20(hash, sig.v, sig.r, sig.s, d.token, d.amount,
        d.destChain, [d.fee, d.ts], { from: accounts[1] });
      const relayBal = await parentToken.balanceOf(parentRelay.address);
      assert.equal(relayBal.toString(), '100');
    });
  });

  describe('Destination chain', async () => {
    it('should make sure we are connecting to the destination chain', async () => {
      const id = await web3.eth.net.getId();
      assert(id > 0);
    });

    it('should create a relay Gateway on the destination chain.', async () => {
      const receipt = await web3.eth.sendTransaction({
        from: accounts[0],
        data: relayBytes,
        gas: 4000000,
      });
      assert(receipt.blockNumber >= 0);
      childRelay = await new web3.eth.Contract(relayABI, receipt.contractAddress);
      assert(receipt.contractAddress === childRelay.options.address);
    });

    it('should create a token on the destination chain', async () => {
      const childTokenTmp = await new web3.eth.Contract(tokenABI);
      await childTokenTmp.deploy({
        data: tokenBytes,
        arguments: [1000, 'Token', 0, 'TKN'],
      }).send({
        from: accounts[0],
        gas: 4000000,
      }).then((newInst) => {
        childToken = newInst;
        assert(childToken.options.address != null);
      });
    });

    it('should move all tokens to the relay contract', async () => {
      const supply = await childToken.methods.totalSupply().call();
      await childToken.methods.transfer(childRelay.options.address, supply).send({
        from: accounts[0],
      });
      const balance = await childToken.methods.balanceOf(childRelay.options.address).call();
      assert(supply === balance);
    });

    // it('should map the token to the one on the origin chain', async () => {
    //   // mapERC20Token(uint oldChainId, address oldToken, address newToken)
    //   const receipt = await childRelay.methods.mapERC20Token(1, parentToken.address,
    //     childToken.options.address).send({ from: accounts[0] });
    //   console.log('receipt', receipt);
    //   const mapping = await childRelay.methods.getTokenMapping(1, parentToken.address).call();
    //   assert(mapping === childToken.address);
    // });
  });

  // describe('Child relay', async () => {
  //   it('should create a relay on a second chain.', async () => {
  //     const relay = contract(relayABI, relayBytes, { from: accounts[0] });
  //     childRelay = relay.new((err, res) => {
  //       assert(err == null, `Error deploying child relay: ${err}`);
  //       assert(res != null);
  //     });
  //     // childRelay = await TrustedRelay.new({ from: accounts[0] });
  //     // tokenChild = await Token.new(1000, 'Token', 0, 'TKN', { from: accounts[1] });
  //   });
  // it('should relay the deposit to the second chain.', async() => { });
  // it('should verify that the deposit was relayed.', async() => { });
  // });
});
