// Util for signing messages
const secrets = require(`${process.cwd()}/secrets.json`);
const bip39 = require('bip39');
const hdkey = require('ethereumjs-wallet/hdkey');
const ethutil = require('ethereumjs-util');
const leftPad = require('left-pad');

function getAddr(index) {
  const hdwallet = hdkey.fromMasterSeed(bip39.mnemonicToSeed(secrets.mnemonic));
  const node = hdwallet.derivePath(secrets.hdPath + String(index));
  const addr = node.getWallet().getAddressString();
  return addr;
}

function sign(msg, index=0) {
  const hdwallet = hdkey.fromMasterSeed(bip39.mnemonicToSeed(secrets.mnemonic));
  const node = hdwallet.derivePath(secrets.hdPath + String(index));
  const pkeyStr = node.getWallet().getPrivateKeyString();
  const pkey = Buffer.from(pkeyStr.slice(2), 'hex');
  const msgBuf = Buffer.from(msg.slice(2), 'hex');
  const sigTmp = ethutil.ecsign(msgBuf, pkey);
  const newSig = {
    r: `0x${leftPad(sigTmp.r.toString('hex'), 64, '0')}`,
    s: `0x${leftPad(sigTmp.s.toString('hex'), 64, '0')}`,
    v: sigTmp.v,
  };
  return newSig;
}

exports.getAddr = getAddr;
exports.sign = sign;
