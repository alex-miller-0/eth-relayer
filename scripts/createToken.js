/* global artifacts assert contract */

// Create a token with a given name, symbol, and decimals. It is deployed
// from eth.accounts[0], which should be unlocked.
const bip39 = require('bip39');
const hdkey = require('ethereumjs-wallet/hdkey');
const secrets = require(`${process.cwd()}/secrets.json`);
const Web3 = require('Web3');
const network = process.argv[2];
const networks = require(`${process.cwd()}/networks.json`);
const host = networks.networks[network].gateway;
const web3 = new Web3(new Web3.providers.HttpProvider(host));
const token = require(`${process.cwd()}/build/contracts/HumanStandardToken.json`);
const tokenAbi = token.abi;
const tokenBytes = token.bytecode;
const jsonfile = require('jsonfile');

const timestamp = new Date().getTime();
const name = process.argv[3] || `Token ${timestamp}`;
const symbol = process.argv[4] || 'T' + String(timestamp).substring(0, 4);
const decimals = process.argv[5] || 0;
const supply = process.argv[6] || 1000;


const hdwallet = hdkey.fromMasterSeed(bip39.mnemonicToSeed(secrets.mnemonic));
const node = hdwallet.derivePath(secrets.hdPath + '1'); // Generating from accounts[1]
const addr = node.getWallet().getAddressString();

const Token = new web3.eth.Contract(tokenAbi);
Token.deploy({
  data: tokenBytes,
  arguments: [supply, name, decimals, symbol],
}).send({
  from: addr,
  gas: 4000000,
}).then((contract) => {
  const contractAddr = contract.options.address;
  if (!networks.tokens) { networks.tokens = {}; }
  if (!networks.tokens[network]) { networks.tokens[network] = {}; }
  networks.tokens[network][contractAddr] = { name, symbol, decimals, supply };
  jsonfile.writeFile(`${process.cwd()}/networks.json`, networks, { spaces: 2 }, () => {
    console.log(`Saved token to network ${network}: ${contractAddr}`)
  })
});
