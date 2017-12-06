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

let d;
let sig;
let hash;

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
    const sigTmp = util.ecsign(msgBuf, pkey);
    const newSig = {
      r: `0x${leftPad(sigTmp.r.toString('hex'), 64, '0')}`,
      s: `0x${leftPad(sigTmp.s.toString('hex'), 64, '0')}`,
      v: sigTmp.v,
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
    const e = leftPad(data.amount.toString(16), 64, '0');
    const f = data.sender.slice(2);
    const g = leftPad(data.fee.toString(16), 64, '0');
    const h = leftPad(data.ts.toString(16), 64, '0');
    return sha3(`0x${a}${b}${c}${e}${f}${g}${h}`);
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
      d = {
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
      hash = hashData(d);
      sig = sign(hash, wallets[1]);
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

    it('should map the token', async () => {
      await childRelay.methods.mapERC20Token(d.origChain, d.token,
        childToken.options.address).send({ from: accounts[0] });
      const mapping = await childRelay.methods.getTokenMapping(d.origChain, d.token)
        .call();
    });

    it('should set the chainId', async () => {
      await childRelay.methods.setChainId(2).send({ from: accounts[0] });
      const chainId = await childRelay.methods.chainId().call();
      assert(chainId === '2');
    });

    it('should move all tokens to the relay contract', async () => {
      const supply = await childToken.methods.totalSupply().call();
      await childToken.methods.transfer(childRelay.options.address, supply).send({
        from: accounts[0],
      });
      const balance = await childToken.methods.balanceOf(childRelay.options.address).call();
      assert(supply === balance);
    });

    it('should relay the message', async () => {
      // const isOwner = await childRelay.methods.checkIsOwner(accounts[0]).call();
      await childRelay.methods.relayDepositERC20(hash, sig.v, sig.r, sig.s,
        [d.token, d.sender], d.amount, d.origChain,
        [d.fee, d.ts]).send({ from: accounts[0], gas: 300000 });
      const balance = await childToken.methods.balanceOf(childRelay.options.address).call();
      assert(balance === '900');
      const userBal = await childToken.methods.balanceOf(d.sender).call();
      assert(userBal === '100');
    });
  });
});
