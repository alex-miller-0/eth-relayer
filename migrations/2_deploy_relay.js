/* global artifacts */

const TrustedRelay = artifacts.require('./TrustedRelay.sol');

module.exports = (deployer) => {
  deployer.deploy(TrustedRelay);

  // const relay = await TrustedRelay.deployed();
  // console.log('relay?', relay)
};
