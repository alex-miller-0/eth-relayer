// Generate a config file with the network ids that can be exported. This file
// will be appeneded when you run 'npm run test', however you need to ensure
// your network URLs are correct as the test will not change those.
//
// To generate this with origin network localhost:7545 and destination network
// localhost:7546, generate a config file with the following command:
//
//   npm run gen-config 7545 7546
//
// Note that including a number is parsed as a port on localhost. If you want
// a different host, you will need to type the whole string,
// e.g. 'https://mainnet.infura.io'.
//
const curl = require('curlrequest');
const jsonfile = require('jsonfile');

// ===== SCRIPT =====

let networkIds = { origin: null, destination: null }
if (process.argv.length != 4) {
  console.log('Please provide input `npm run gen-config <origin host> <destination host>`')
} else {
  const data = parseArgv();
  const origin = data.origin;
  const destination = data.destination;
  getNet(origin, 1, (err, res) => {
    if (err) { console.log('Error getting id of origin network:', err); }
    else {
      let parsed = JSON.parse(res);
      networkIds.origin = parsed.result;
      getNet(destination, 2, (err2, res2) => {
        if (err2) { console.log('Error getting id of destination network:', err2); }
        else {
          let parsed2 = JSON.parse(res2);
          networkIds.destination = parsed2.result;
          saveConfig(networkIds.origin, networkIds.destination, origin, destination);
        };
      });
    };
  });
}

// ===== UTIL FUNCTIONS =====

function saveConfig(originId, destId, originUrl, destUrl) {
  let networks = { networks : {} };
  networks.networks[originId] = { name: 'Origin', value: '', gateway: originUrl };
  networks.networks[destId] = { name: 'Destination', value: '', gateway: destUrl };
  jsonfile.writeFile('./networks.json', networks, { spaces: 2 }, (err) => {
    if (err) { console.log('Error writing config file: ', err); }
    else { console.log('Success! Networks saved to ./networks.json\n'); }
  })
}

function parseArgv() {
  let origin;
  let destination;
  try {
    const originPort = parseInt(process.argv[2]);
    origin = `http://localhost:${originPort}`;
  } catch(err) {
    origin = process.argv[2];
  }
  try {
    const destPort = parseInt(process.argv[3]);
    destination = `http://localhost:${destPort}`;
  } catch(err) {
    destination = process.argv[3];
  }
  return { origin, destination };
}

function getNet(host, id, cb) {
  const options = {
    method: 'POST',
    data: `{"jsonrpc":"2.0","method":"net_version","params":[],"id":${id}}`,
    url: host
  };
  curl.request(options, cb);
}
