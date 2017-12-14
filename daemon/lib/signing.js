// Util for signing messages
const secrets = require(`${process.cwd()}/secrets.json`);
const bip39 = require('bip39');
const hdkey = require('ethereumjs-wallet/hdkey');

function getAddr(index) {
  const hdwallet = hdkey.fromMasterSeed(bip39.mnemonicToSeed(secrets.mnemonic));
  const node = hdwallet.derivePath(secrets.hdPath + String(index));
  const addr = node.getWallet().getAddressString();
  return addr;
}

exports.getAddr = getAddr;
