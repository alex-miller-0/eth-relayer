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
    hash: msg,
  };
  return newSig;
}

// Hash a set of data and return the signature
function hashAndSign(data) {
  const hash = _hashData(data);
  const sig = sign(hash);
  return sig;
}

function _hashData(data) {
  // NOTE: Solidity tightly packs addresses as 20-byte strings. Everything else
  // is packed as a 32 byte string. This is a weird idiosyncracy.
  const a = data.fromChain.toLowerCase().slice(2);
  const b = data.toChain.toLowerCase().slice(2);
  const c = data.oldToken.toLowerCase().slice(2);
  const e = leftPad(parseInt(data.amount, 10).toString(16), 64, '0');
  const f = data.sender.toLowerCase().slice(2);
  const g = leftPad(parseInt(data.fee, 10).toString(16), 64, '0');
  const h = leftPad(parseInt(data.timestamp, 10).toString(16), 64, '0');
  const msg = `${a}${b}${c}${e}${f}${g}${h}`;
  const personal = ethutil.hashPersonalMessage(Buffer.from(msg, 'hex'));
  return `0x${personal.toString('hex')}`;
}

exports.hashAndSign = hashAndSign;
exports.getAddr = getAddr;
exports.sign = sign;
