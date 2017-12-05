const HDWalletProvider = require('truffle-hdwallet-provider');
const mnemonic = require('./secrets.json').mnemonic;

module.exports = {
  networks: {
    development: {
      host: 'localhost',
      port: 7545,
      network_id: '*', // Match any network id
    },
    ropsten: {
      provider: new HDWalletProvider(mnemonic, 'https://ropsten.infura.io/'),
      network_id: 3, // official id of the ropsten network
    },
  },
};
