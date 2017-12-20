// Generic util FUNCTIONS
const networks = require('../../networks.json');

function checkApprovedToken(curNet, refNet, refToken, fee) {
  const key = getNetwork(curNet);
  return networks.networks[key].tokens[refNet.toLowerCase()][refToken.toLowerCase()] ? true : false;
}

function getNetwork(value) {
  let match = null;
  Object.keys(networks.networks).forEach((key) => {
    if (networks.networks[key].value.toLowerCase() == value.toLowerCase()) {
      match = key;
    }
  })
  return match;
}

exports.checkApprovedToken = checkApprovedToken;
