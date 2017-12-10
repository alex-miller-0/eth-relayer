/* eslint-env mocha */
/* global artifacts assert contract */

const bip39 = require('bip39');
const hdkey = require('ethereumjs-wallet/hdkey');
const leftPad = require('left-pad');
const secrets = require('../secrets.json');
// const sha3 = require('solidity-sha3').default;
const util = require('ethereumjs-util');
const truffleConf = require('../truffle.js').networks;
const Web3 = require('web3');
const jsonfile = require('jsonfile');

const provider = `http://${truffleConf.devChild.host}:${truffleConf.devChild.port}`;
const web3 = new Web3(new Web3.providers.HttpProvider(provider));

const relayABI = require('../build/contracts/TrustedRelay.json').abi;
const relayBytes = require('../build/contracts/TrustedRelay.json').bytecode;
const tokenABI = require('../build/contracts/HumanStandardToken.json').abi;
const tokenBytes = require('../build/contracts/HumanStandardToken.json').bytecode;

const Token = artifacts.require('HumanStandardToken.sol'); // EPM package
const TrustedRelay = artifacts.require('./TrustedRelay');

// For updating the networks file (for testing front end)
let networks;
const NETWORK_F = 'networks.json';

let parentRelay = null;
let parentToken = null;
let childRelay = null;
let childToken = null;
let etherToken = null;

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
    const a = data.origChain.slice(2);
    const b = data.destChain.slice(2);
    const c = data.token.slice(2);
    const e = leftPad(data.amount.toString(16), 64, '0');
    const f = data.sender.slice(2);
    const g = leftPad(data.fee.toString(16), 64, '0');
    const h = leftPad(data.ts.toString(16), 64, '0');
    const msg = `${a}${b}${c}${e}${f}${g}${h}`;
    const personal = util.hashPersonalMessage(Buffer.from(msg, 'hex'));
    // console.log('personal', personal.toString('hex'));
    return `0x${personal.toString('hex')}`;
  }

  function isEVMException(err) {
    return err.toString().includes('VM Exception');
  }

  function addChainId(name, chainId) {
    if (networks) {
      Object.keys(networks.networks).forEach((key) => {
        if (networks.networks[key].name === name) {
          networks.networks[key].value = chainId;
        }
      });
    }
  }

  describe('Setup', () => {
    it('should check for networks file', async () => {
      try {
        networks = jsonfile.readFileSync(NETWORK_F);
      } catch (e) {
        networks = null;
      }
    });
  });

  describe('Origin chain', () => {
    it('should make sure the owner is accounts[0].', async () => {
      parentRelay = await TrustedRelay.deployed();
      addChainId('Origin', parentRelay.address);
      // console.log('Origin Gateway', parentRelay.address);
      const isOwner = await parentRelay.checkIsOwner(accounts[0]);
      assert(isOwner === true);
    });

    it('should create a new token on the main chain and set approval.', async () => {
      parentToken = await Token.new(1000, 'Token', 0, 'TKN', { from: accounts[1] });
      const userBal = await parentToken.balanceOf(accounts[1]);
      assert(userBal.toString() === '1000');
      await parentToken.approve(parentRelay.address, 100, { from: accounts[1] });
      const approval = await parentToken.allowance(accounts[1], parentRelay.address);
      assert(approval.toString() === '100');
      // console.log('Parent Token (origin)', parentToken.address);
      if (networks) { networks.tokens = { origin: parentToken.address }; }
    });

    it('should generate two wallets for accounts[0] and accounts[1].', async () => {
      wallets = generateFirstWallets(2, [], 0);
      assert(wallets.length === 2);
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
      addChainId('Destination', childRelay.options.address);
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
        // console.log('Child Token (origin)', childToken.options.address);
        if (networks) { networks.tokens.destination = childToken.options.address; }

        d = {
          origChain: parentRelay.address.toLowerCase(),
          destChain: childRelay.options.address.toLowerCase(),
          token: parentToken.address.toLowerCase(),
          amount: 100,
          sender: accounts[1].toLowerCase(),
          fee: 0,
          ts: null,
        };
      });
    });

    it('should map the token', async () => {
      await childRelay.methods.mapERC20Token(d.origChain, d.token,
        childToken.options.address).send({ from: accounts[0] });
      const mapping = await childRelay.methods.getTokenMapping(d.origChain, d.token)
        .call();
      assert(mapping != null);
    });

    it('should move all tokens to the relay contract', async () => {
      const supply = await childToken.methods.totalSupply().call();
      await childToken.methods.transfer(childRelay.options.address, supply).send({
        from: accounts[0],
      });
      const balance = await childToken.methods.balanceOf(childRelay.options.address).call();
      assert(supply === balance);
    });

    it('should deposit 100 tokens to the relay.', async () => {
      const now = await parentRelay.getNow();
      d.ts = parseInt(now.toString(), 10) + 1;
      hash = hashData(d);
      sig = sign(hash, wallets[1]);

      // const thash = await parentRelay.testHash(d.destChain, d.origChain, d.amount, d.token,
      //   [d.fee, d.ts], { from: accounts[1] });
      // console.log('solidity hash', thash);

      await parentRelay.depositERC20(hash, sig.v, sig.r, sig.s, d.token, d.amount,
        d.destChain, [d.fee, d.ts], { from: accounts[1] });
      const relayBal = await parentToken.balanceOf(parentRelay.address);
      assert.equal(relayBal.toString(), '100');
    });

    it('should relay the message', async () => {
      await childRelay.methods.relayDeposit(hash, sig.v, sig.r, sig.s,
        [d.token, d.sender], d.amount, d.origChain,
        [d.fee, d.ts]).send({ from: accounts[0], gas: 300000 });
      const balance = await childToken.methods.balanceOf(childRelay.options.address).call();
      assert(balance === '900');
      const userBal = await childToken.methods.balanceOf(d.sender).call();
      assert(userBal === '100');
    });

    it('should fail to relay the message a second time', async () => {
      try {
        await childRelay.methods.relayDeposit(hash, sig.v, sig.r, sig.s,
          [d.token, d.sender], d.amount, d.origChain,
          [d.fee, d.ts]).send({ from: accounts[0], gas: 300000 });
      } catch (err) {
        assert(isEVMException(err) === true);
      }
    });
  });

  describe('Ether tokens', async () => {
    // 100,000 tokens
    const tokens = '1000000000';
    const transfer = String(parseInt(tokens, 10) * 0.01);
    const multiplier = String(10 ** 8);
    let deposit = {};
    let startingBal;

    it('should get the starting user balance on the destination chain', async () => {
      const startingBalTmp = await web3.eth.getBalance(accounts[1]);
      startingBal = parseInt(startingBalTmp, 10);
    });

    it('should create an ether token on the main chain.', async () => {
      etherToken = await Token.new(tokens, 'EtherToken', 10, 'ETKN', { from: accounts[0] });
      if (networks) { networks.tokens.etherToken = etherToken.address; }
      const userBal = await etherToken.balanceOf(accounts[0]);
      assert(userBal.toString() === tokens);
    });

    it('should fail to move an equal amount of ether to the destination Gateway', async () => {
      try {
        await web3.eth.sendTransaction({
          from: accounts[0],
          to: childRelay.options.address,
          value: tokens,
        });
      } catch (err) {
        assert(isEVMException(err) === true);
      }
    });

    it('should allow ether deposits on the origin Gateway', async () => {
      await childRelay.methods.changeEtherAllowed(true).send({ from: accounts[0] });
      const allowed = await childRelay.methods.etherAllowed().call();
      assert(allowed === true);
    });

    it('should map etherToken to ether in destination Gateway', async () => {
      await childRelay.methods.mapEthToken(parentRelay.address, etherToken.address)
        .send({ from: accounts[0] });
      const mapping = await childRelay.methods.getEthTokenMapping(parentRelay.address)
        .call();
      assert(mapping.toLowerCase() === etherToken.address.toLowerCase());
    });

    it('should set the multiplier', async () => {
      // Token has 10 decimals - need to multiply all tokens by 10**8 to get
      // the amount of wei.
      await childRelay.methods.setEthMultiplier(parentRelay.address, 10 ** 8)
        .send({ from: accounts[0] });
      const mult = await childRelay.methods.getEthMultiplier(parentRelay.address)
        .call();
      assert(mult === multiplier);
    });

    it('should move an equal amount of ether to the destination Gateway', async () => {
      await web3.eth.sendTransaction({
        from: accounts[0],
        to: childRelay.options.address,
        value: String(parseInt(tokens, 10) * multiplier),
      });
      const balance = await web3.eth.getBalance(childRelay.options.address);
      assert(balance.toString() === String(tokens * multiplier));
    });

    it('should move 0.01 etherToken to accounts[1]', async () => {
      await etherToken.transfer(accounts[1], transfer, { from: accounts[0] });
      const balance = await etherToken.balanceOf(accounts[1]);
      assert(balance.toString() === transfer);
    });

    it('should allow the relay to move 1 etherToken', async () => {
      await etherToken.approve(parentRelay.address, transfer, { from: accounts[1] });
      const approval = await etherToken.allowance(accounts[1], parentRelay.address);
      assert(approval.toString() === transfer);
    });

    it('should deposit the etherToken to the origin Gateway', async () => {
      const userBal1 = await etherToken.balanceOf(accounts[1]);
      assert(userBal1.toString() === transfer);
      const now = await parentRelay.getNow();
      deposit = {
        origChain: parentRelay.address.toLowerCase(),
        destChain: childRelay.options.address.toLowerCase(),
        token: etherToken.address.toLowerCase(),
        amount: parseInt(transfer, 10),
        sender: accounts[1].toLowerCase(),
        fee: 0,
        ts: 1 + parseInt(now.toString(), 10),
      };
      hash = hashData(deposit);
      sig = sign(hash, wallets[1]);
      await parentRelay.depositERC20(hash, sig.v, sig.r, sig.s, deposit.token,
        deposit.amount, deposit.destChain, [deposit.fee, deposit.ts],
        { from: accounts[1] });
      const relayBal = await etherToken.balanceOf(parentRelay.address);
      assert.equal(relayBal.toString(), String(deposit.amount));
    });

    it('should relay the message to the destination chain', async () => {
      await childRelay.methods.relayDeposit(hash, sig.v, sig.r, sig.s,
        [deposit.token, deposit.sender], deposit.amount, deposit.origChain,
        [deposit.fee, deposit.ts]).send({ from: accounts[0], gas: 300000 });
      const relayBalance = await web3.eth.getBalance(childRelay.options.address);
      const userBalance = await web3.eth.getBalance(deposit.sender);
      const expectedRelayBal = multiplier * (parseInt(tokens, 10) - deposit.amount);
      const expectedUserBal = multiplier * deposit.amount;
      const userBalDiff = parseInt(userBalance, 10) - startingBal;
      assert(relayBalance === String(expectedRelayBal));
      assert(String(userBalDiff) === String(expectedUserBal));
    });

    const zeroAddr = '0x0000000000000000000000000000000000000000';
    let deposit2 = {};
    let toSend;

    it('should deposit 0.005 ether to the destination relay', async () => {
      toSend = deposit.amount * parseInt(multiplier, 10);
      const now = await childRelay.methods.getNow().call();
      const userBal = await web3.eth.getBalance(accounts[1]);
      const startingUserBal = parseInt(userBal, 10);
      const relayBal = await web3.eth.getBalance(childRelay.options.address);
      const startingRelayBal = parseInt(relayBal, 10);
      assert(startingUserBal >= deposit.amount);

      // The amount is included in the hashed message, but the amount sent
      // in msg.value is this amount times the multiplier. This is a hack for
      // when the token has fewer than 18 decimals.
      deposit2 = {
        origChain: childRelay.options.address.toLowerCase(),
        destChain: parentRelay.address.toLowerCase(),
        token: zeroAddr,
        amount: deposit.amount,
        sender: accounts[1].toLowerCase(),
        fee: 0,
        ts: 1 + parseInt(now.toString(), 10),
      };
      hash = hashData(deposit2);
      sig = sign(hash, wallets[1]);
      await childRelay.methods.depositEther(hash, sig.v, sig.r, sig.s, deposit2.destChain,
        [deposit2.fee, deposit2.ts]).send({ from: accounts[1], value: toSend });

      const newRelayBal = await web3.eth.getBalance(childRelay.options.address);
      assert(String(startingRelayBal + toSend) === String(newRelayBal));
    });

    it('should map the destination ether to an origin token', async () => {
      await parentRelay.mapERC20Token(childRelay.options.address, zeroAddr,
        etherToken.address, { from: accounts[0] });
      const mapping = await parentRelay.getTokenMapping(childRelay.options.address, zeroAddr);
      assert(mapping === etherToken.address);
    });

    it('should relay the message to the destination chain', async () => {
      const userBalBeforeTmp = await etherToken.balanceOf(deposit.sender);
      const userBalBefore = userBalBeforeTmp.toString();
      // const relayBalBeforeTmp = await etherToken.balanceOf(parentRelay.address);
      // const relayBalBefore = relayBalBeforeTmp.toString();
      await parentRelay.relayDeposit(hash, sig.v, sig.r, sig.s,
        [deposit2.token, deposit2.sender], deposit2.amount, deposit2.origChain,
        [deposit2.fee, deposit2.ts], { from: accounts[0], gas: 300000 });

      const userBalAfterTmp = await etherToken.balanceOf(deposit.sender);
      const userBalAfter = userBalAfterTmp.toString();

      assert(parseInt(userBalAfter, 10) ===
        parseInt(userBalBefore, 10) + parseInt(deposit2.amount, 10));
    });
  });

  // I will be sneaky here and test two things:
  // 1) Test that destination->origin works for ERC20<->ERC20
  // 2) Test that the mechanism to undoDeposit works
  describe('Revert relays', async () => {
    let dep = {};
    let startingRelayBal;

    it('should give childToken allowance to destination Gateway', async () => {
      childToken.methods.approve(childRelay.options.address, 1).send({ from: accounts[1] });
      const startingRelayBalTmp = await childToken.methods
        .balanceOf(childRelay.options.address).call();
      startingRelayBal = parseInt(startingRelayBalTmp.toString(), 10);
    });

    it('should deposit childToken to destination Gateway', async () => {
      const tmp = await childToken.methods.balanceOf(accounts[1]).call();
      const starting = parseInt(tmp, 10);
      assert(starting >= 1);

      const now = await parentRelay.getNow();
      dep = {
        origChain: childRelay.options.address,
        destChain: parentRelay.address,
        token: childToken.options.address,
        amount: 1,
        sender: accounts[1],
        fee: 0,
        ts: 1 + parseInt(now.toString(), 10),
      };
      hash = hashData(dep);
      sig = sign(hash, wallets[1]);
      await childRelay.methods.depositERC20(hash, sig.v, sig.r, sig.s, dep.token,
        dep.amount, dep.destChain, [dep.fee, dep.ts]).send({ from: accounts[1] });
      const relayBal = await childToken.methods.balanceOf(childRelay.options.address).call();
      assert.equal(parseInt(relayBal.toString(), 10) - startingRelayBal, 1);
    });

    it('should map the childToken', async () => {
      await parentRelay.mapERC20Token(dep.origChain, dep.token, parentToken.address, {
        from: accounts[0],
      });
      const mapping = await parentRelay.getTokenMapping(dep.origChain, dep.token);
      assert(mapping === parentToken.address);
    });

    it('should relay the message to the origin Gateway', async () => {
      const userBalBeforeTmp = await parentToken.balanceOf(dep.sender);
      const userBalBefore = parseInt(userBalBeforeTmp.toString(), 10);
      const relayBalBeforeTmp = await parentToken.balanceOf(parentRelay.address);
      const relayBalBefore = parseInt(relayBalBeforeTmp.toString(), 10);

      await parentRelay.relayDeposit(hash, sig.v, sig.r, sig.s,
        [dep.token, dep.sender], dep.amount, dep.origChain,
        [dep.fee, dep.ts], { from: accounts[0], gas: 300000 });

      const userBalAfterTmp = await parentToken.balanceOf(dep.sender);
      const userBalAfter = parseInt(userBalAfterTmp.toString(), 10);
      const relayBalAfterTmp = await parentToken.balanceOf(parentRelay.address);
      const relayBalAfter = parseInt(relayBalAfterTmp.toString(), 10);

      assert(userBalAfter - userBalBefore === dep.amount);
      assert(relayBalBefore - relayBalAfter === dep.amount);
    });

    it('should cancel the deposit', async () => {
      const userBeforeTmp = await childToken.methods.balanceOf(dep.sender).call();
      const userBefore = parseInt(userBeforeTmp.toString(), 10);
      const relayBeforeTmp = await childToken.methods.balanceOf(childRelay.options.address)
        .call();
      const relayBefore = parseInt(relayBeforeTmp.toString(), 10);

      await childRelay.methods.undoDeposit([hash, sig.r, sig.s], sig.v,
        [dep.token, dep.sender], dep.amount, dep.destChain, [dep.fee, dep.ts])
        .send({ from: accounts[0] });

      const userAfterTmp = await childToken.methods.balanceOf(dep.sender).call();
      const userAfter = parseInt(userAfterTmp.toString(), 10);
      const relayAfterTmp = await childToken.methods.balanceOf(childRelay.options.address)
        .call();
      const relayAfter = parseInt(relayAfterTmp.toString(), 10);

      assert(userAfter - userBefore === dep.amount);
      assert(relayBefore - relayAfter === dep.amount);
    });
  });

  describe('Cleanup', async () => {
    it('should write the networks file', async () => {
      jsonfile.writeFile(NETWORK_F, networks, { spaces: 2 }, (err) => {
        if (err) console.log('Error writing networks.json', err);
      });
    });
  });
});
