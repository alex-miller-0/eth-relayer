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
// Should require 'tokens/HumanStandardToken.sol' - this is a workaround
// https://github.com/trufflesuite/truffle/issues/630
// const Token = artifacts.require('HumanStandardToken.sol');
// const ethQuery = new EthQuery(new HttpProvider('http://localhost:7545'));

contract('SimpleMultisig', (accounts) => {
  assert(accounts.length > 0);

  // function isEVMException(err) {
  //   return err.toString().includes('VM Exception');
  // }
  describe('Setup parent relay', () => {
    it('Should make sure the owner is accounts[0]', async () => {
      const relay = await TrustedRelay.deployed();
      const isOwner = await relay.checkIsOwner(accounts[0]);
      console.log('isOwner', isOwner);
    });
  });
});
