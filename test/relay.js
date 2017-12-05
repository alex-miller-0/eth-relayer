/* eslint-env mocha */
/* global artifacts assert contract */

const bip39 = require('bip39');
// const EthQuery = require('ethjs-query');
const hdkey = require('ethereumjs-wallet/hdkey');
// const HttpProvider = require('ethjs-provider-http');
const leftPad = require('left-pad');
const secrets = require('../secrets.json');
const sha3 = require('solidity-sha3').default;
const util = require('ethereumjs-util');

const TrustedRelay = artifacts.require('./TrustedRelay');
let parentRelay = null;
// Should require 'tokens/HumanStandardToken.sol' - this is a workaround
// https://github.com/trufflesuite/truffle/issues/630
const Token = artifacts.require('HumanStandardToken.sol');
let tokenMain = null;
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
  describe('Parent relay', () => {
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
      tokenMain = await Token.new(1000, 'Main', 0, 'MAIN', { from: accounts[1] });
      const userBal = await tokenMain.balanceOf(accounts[1]);
      assert(userBal.toString() === '1000');
      await tokenMain.approve(parentRelay.address, 100, { from: accounts[1] });
      const approval = await tokenMain.allowance(accounts[1], parentRelay.address);
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
        token: tokenMain.address,
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
      const relayBal = await tokenMain.balanceOf(parentRelay.address);
      assert.equal(relayBal.toString(), '100');
    });
  });

  // describe('Child relay', async () => {
  //   it('should create a relay on a second chain.', async () => { });
  //   it('should relay the deposit to the second chain.', async() => { });
  //   it('should verify that the deposit was relayed.', async() => { });
  // });
});
