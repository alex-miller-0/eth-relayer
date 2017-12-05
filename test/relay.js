/* eslint-env mocha */
/* global artifacts assert contract */

// const bip39 = require('bip39');
// const EthQuery = require('ethjs-query');
// const hdkey = require('ethereumjs-wallet/hdkey');
// const HttpProvider = require('ethjs-provider-http');
// const leftPad = require('left-pad');
// const secrets = require('../secrets.json');
// const sha3 = require('solidity-sha3').default;
// const util = require('ethereumjs-util');

const TrustedRelay = artifacts.require('./TrustedRelay');
let parentRelay = null;
// Should require 'tokens/HumanStandardToken.sol' - this is a workaround
// https://github.com/trufflesuite/truffle/issues/630
const Token = artifacts.require('HumanStandardToken.sol');
let tokenMain = null;
// const ethQuery = new EthQuery(new HttpProvider('http://localhost:7545'));


contract('TrustedRelay', (accounts) => {
  assert(accounts.length > 0);

  // function isEVMException(err) {
  //   return err.toString().includes('VM Exception');
  // }
  describe('Parent relay', () => {
    it('should make sure the owner is accounts[0].', async () => {
      parentRelay = await TrustedRelay.deployed();
      const isOwner = await parentRelay.checkIsOwner(accounts[0]);
      assert(isOwner === true);
    });

    it('should create a new token on the main chain and set approval.', async () => {
      tokenMain = await Token.new(1000, 'Main', 0, 'MAIN', { from: accounts[0] });
      const userBal = await tokenMain.balanceOf(accounts[0]);
      assert(userBal.toString() === '1000');
      await tokenMain.approve(parentRelay.address, 100, { from: accounts[0] });
      const approval = await tokenMain.allowance(accounts[0], parentRelay.address);
      assert(approval.toString() === '100');
    });

    it('should deposit 100 tokens to the relay.', async () => {});
  });

  // describe('Child relay', async () => {
  //   it('should create a relay on a second chain.', async () => { });
  //   it('should relay the deposit to the second chain.', async() => { });
  //   it('should verify that the deposit was relayed.', async() => { });
  // });
});
