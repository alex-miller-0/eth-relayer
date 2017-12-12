// Boot a parity PoA chain (single node) with one or more specified ports
const secrets = require('../secrets.json');
const bip39 = require('bip39');
const hdkey = require('ethereumjs-wallet/hdkey');
const fs = require('fs');
const jsonfile = require('jsonfile');
const spawn = require('child_process').spawn;

// Create a directory for the poa chain data if it doesn't exist
const DATA_DIR = `${process.cwd()}/scripts/poa`;
if(fs.existsSync(DATA_DIR)) { rmrfDirSync(DATA_DIR) };
fs.mkdirSync(DATA_DIR);

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

// Pull wallets out of the secret mnemonic
const wallets = generateFirstWallets(10, [], 0);
let keys = [];
let addrs = [];
wallets.forEach((wallet) => {
  keys.push(wallet[1]);
  addrs.push(wallet[0]);
});

// Create a bunch of config filges given ports specified in the script arguments
const ports = process.argv.slice(2)
// Create a set of parity config files
ports.forEach((_port, i) => {
  const port = parseInt(_port);
  let tmpConfig = {
    name: `LocalPoA_${port}`,
    engine: {
      authorityRound: {
        params: {
          gasLimitBoundDivisor: "0x400",
          stepDuration: 2,
          validators: {
            list: addrs,
          }
        }
      }
    },
    params: {
      gasLimitBoundDivisor: "0x400",
      maximumExtraDataSize: "0x20",
      minGasLimit: "0x1388",
      networkID: `0x${port.toString(16)}`
    },
    genesis: {
      seal: {
        authorityRound: {
          step: "0x0",
          signature: "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
        }
      },
      difficulty: "0x20000",
      gasLimit: "0x5B8D80"
    },
    accounts: {
      "0x0000000000000000000000000000000000000001": { "balance": "1", "builtin": { "name": "ecrecover", "pricing": { "linear": { "base": 3000, "word": 0 } } } },
      "0x0000000000000000000000000000000000000002": { "balance": "1", "builtin": { "name": "sha256", "pricing": { "linear": { "base": 60, "word": 12 } } } },
      "0x0000000000000000000000000000000000000003": { "balance": "1", "builtin": { "name": "ripemd160", "pricing": { "linear": { "base": 600, "word": 120 } } } },
      "0x0000000000000000000000000000000000000004": { "balance": "1", "builtin": { "name": "identity", "pricing": { "linear": { "base": 15, "word": 3 } } } }
    }
  };
  addrs.forEach((addr) => {
    tmpConfig.accounts[addr] = { "balance": "1000000000000000000000" };
  });
  const PATH = `${DATA_DIR}/${port}`;
  if(!fs.existsSync(PATH)) { fs.mkdirSync(PATH); }
  jsonfile.writeFile(`${PATH}/config.json`, tmpConfig, { spaces: 2 }, () => {});

  // Allow web sockets (for listening on events)
  const wsPort = String(port + 1);

  // Spawn the parity process
  const access = fs.createWriteStream(`${PATH}/log`, { flags: 'a' });
  const error = fs.createWriteStream(`${PATH}/error.log`, { flags: 'a' });
  const parity = spawn('parity', ['--chain', `${PATH}/config.json`, '-d', `${PATH}/data`,
    '--jsonrpc-port', String(port), '--ws-port', wsPort, '--port', String(port+2),
    '--ui-port', String(port+3),
    '--jsonrpc-apis', 'web3,eth,net,personal,parity,parity_set,traces,rpc,parity_accounts'],
    { stdio: 'pipe', cwd: PATH });
  parity.stdout.pipe(access);
  parity.stderr.pipe(error);
  parity.on('close', () => {
    setTimeout(() => {
      console.log(new Date(), `Parity killed (RPC port ${port})`);
    }, 1000);
  });

  console.log(`${new Date()} Parity PoA chain #${i} started. RPC port=${port} WS port=${wsPort}`);
});

function rmrfDirSync(path) {
  if (fs.existsSync(path)) {
    fs.readdirSync(path).forEach(function(file, index){
      var curPath = path + "/" + file;
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        rmrfDirSync(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};
