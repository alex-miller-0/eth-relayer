/* global artifacts */

const Migrations = artifacts.require('./Migrations.sol');
const TrustedRelay = artifacts.require('./TrustedRelay.sol');

module.exports = (deployer) => {
  deployer.deploy(Migrations);
  deployer.deploy(TrustedRelay);
};
