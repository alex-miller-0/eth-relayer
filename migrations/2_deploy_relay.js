/* global artifacts */

const TrustedRelay = artifacts.require('./TrustedRelay.sol');
const truffleConfig = require('../truffle.js');
const networkFile = `${process.cwd()}/../networks.json`;
const jsonfile = require('jsonfile');

let networks;
try {
  networks = require(networkFile);
} catch(e) {
  networks = { networks: {} }
}

const save = async function save(deployer) {
  const network_id = deployer.network_id;
  const network = truffleConfig.networks[deployer.network];
  const host = `http://${network.host}:${network.port}`;
  const relay = await TrustedRelay.deployed();
  const gatewayContract = relay.address;

  const newNetwork = {
    name: "",
    value: relay.address,
    gateway: host
  }
  networks.networks[network_id] = newNetwork;
  jsonfile.writeFile(networkFile, networks, { spaces: 2 }, () => {
    console.log('networks.json file updated.')
  })
}

module.exports = (deployer) => {
  return deployer.deploy(TrustedRelay)
    .then(() => {
      save(deployer);
    })
};
