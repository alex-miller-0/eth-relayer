// Boot a parity PoA chain (single node) with one or more specified ports
const secrets = require('../secrets.json');
const bip39 = require('bip39');
const hdkey = require('ethereumjs-wallet/hdkey');
const fs = require('fs');
const jsonfile = require('jsonfile');
const spawn = require('child_process').spawn;
const Spectcl = require('spectcl');

// The password that will be used for accounts (these are temporary accounts on
// private chains)
const password = 'password';
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
  const chainName = `LocalPoA_${port}`;
  let tmpConfig = genConfig(chainName, port);
  addrs.forEach((addr) => {
    tmpConfig.accounts[addr] = { "balance": "1000000000000000000000" };
  });
  const PATH = `${DATA_DIR}/${port}`;
  if(!fs.existsSync(PATH)) { fs.mkdirSync(PATH); }
  jsonfile.writeFile(`${PATH}/config.json`, tmpConfig, { spaces: 2 }, () => {

    // Create a signer for the chain
    const session = new Spectcl();
    const cmd = `parity account new --chain ${PATH}/config.json --keys-path ${PATH}/keys`;
    session.spawn(cmd)
    session.expect([
      'Type password:', function(match, matched, outer_cb){
          session.send('password\n')
          session.expect([
              'Repeat password:', function(match, matched, inner_cb){
                  session.send('password\n')
                  inner_cb()
              }
          ], function(err){
              outer_cb()
          })
      }
    ], function(err){
      if (err) { throw err; }
      // NOTE: I had to add a timeout because there was a race condition.
      // 300ms seems to work but if you're getting errors try increasing it.
      setTimeout(() => {
        // // Get address from the new wallet
        jsonfile.readFile(`${PATH}/config.json`, (err, file) => {
          // Add signer to it
          const fname = fs.readdirSync(`${PATH}/keys/${chainName}`)[0];
          const _k = fs.readFileSync(`${PATH}/keys/${chainName}/${fname}`);
          const k = JSON.parse(_k);
          const signer = `0x${k.address}`;
          let config = file;
          console.log('signer', signer)
          config.accounts[signer] = { "balance": "1000000000000000000000" };
          jsonfile.writeFile(`${PATH}/config.json`, config, { spaces: 2}, () => {
            // Spawn the parity process
            const access = fs.createWriteStream(`${PATH}/log`, { flags: 'a' });
            const error = fs.createWriteStream(`${PATH}/error.log`, { flags: 'a' });
            // Allow web sockets (for listening on events)
            const wsPort = String(port + 1);
            const parity = spawn('parity', ['--chain', `${PATH}/config.json`, '-d', `${PATH}/data`,
              '--jsonrpc-port', String(port), '--ws-port', wsPort, '--port', String(port+2),
              '--ui-port', String(port+3), '--force-sealing',
              '--jsonrpc-apis', 'web3,eth,net,personal,parity,parity_set,traces,rpc,parity_accounts',
              '--author', signer, '--engine-signer', signer, '--reseal-on-txs', 'all',
              '--rpccorsdomain', '*', '--jsonrpc-interface', 'all',
              '--jsonrpc-hosts', 'all', '--keys-path', `${PATH}/keys`,
              '--unlock', signer, '--password', `${DATA_DIR}/../pw`],
              { stdio: 'pipe', cwd: PATH });
            parity.stdout.pipe(access);
            parity.stderr.pipe(error);
            parity.on('close', () => {
              setTimeout(() => {
                console.log(new Date(), `Parity killed (RPC port ${port})`);
              }, 1000);
            });

            console.log(`${new Date()} Parity PoA chain #${i} started. RPC port=${port} WS port=${wsPort}`);
          })
        });
      }, 500)
    })

  });
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

function genConfig(name, port) {
  const config = {
    name: name,
    engine: {
      instantSeal: { params: {} }
    },
    params: {
      gasLimitBoundDivisor: "0x400",
      maximumExtraDataSize: "0x20",
      minGasLimit: "0x1388",
      networkID: `0x${port.toString(16)}`
    },
    "genesis": {
        "seal": {
          "generic": "0x0"
        },
        "difficulty": "0x20000",
        "author": "0x0000000000000000000000000000000000000000",
        "timestamp": "0x00",
        "parentHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
        "extraData": "0x",
        "gasLimit": "0x1312d00"
    },
    accounts: {
      "0x0000000000000000000000000000000000000001": { "balance": "1", "builtin": { "name": "ecrecover", "pricing": { "linear": { "base": 3000, "word": 0 } } } },
      "0x0000000000000000000000000000000000000002": { "balance": "1", "builtin": { "name": "sha256", "pricing": { "linear": { "base": 60, "word": 12 } } } },
      "0x0000000000000000000000000000000000000003": { "balance": "1", "builtin": { "name": "ripemd160", "pricing": { "linear": { "base": 600, "word": 120 } } } },
      "0x0000000000000000000000000000000000000004": { "balance": "1", "builtin": { "name": "identity", "pricing": { "linear": { "base": 15, "word": 3 } } } }
    }
  };
  return config;
}
