// Generic util FUNCTIONS
const networks = require('../../networks.json');

function checkApprovedToken(token, fee) {
  return networks.tokens.token ? true : false;
}
