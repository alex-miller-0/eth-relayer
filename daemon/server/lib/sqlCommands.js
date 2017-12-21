// Pre-written SQL functions

function deposit(evt) {
  const m = `INSERT INTO Deposits (sender, oldToken, fee, hash, senderR, senderS, \
    senderV, toChain, fromChain, amount, timestamp) VALUES \
    ('${evt.sender.toLowerCase()}', '${evt.oldToken.toLowerCase()}', \
    ${parseInt(evt.fee, 10)}, '${evt.sig.m.toLowerCase()}', '${evt.sig.r.toLowerCase()}', \
    '${evt.sig.s.toLowerCase()}', ${parseInt(evt.sig.v)-27}, '${evt.toChain.toLowerCase()}', \
    '${evt.fromChain.toLowerCase()}', ${parseInt(evt.amount, 10)}, \
    ${parseInt(evt.timestamp, 10)})`;
  return m;
}

function getDeposits(data) {
  console.log('data', data.sender.toLowerCase())
  let m = `SELECT * FROM Deposits WHERE sender='${data.sender.toLowerCase()}'`;
  if (data.pending) { m += ' AND relayId IS NULL' };
  m += ` LIMIT ${data.n || 100}`;
  return m;
}

const createDeposits = 'CREATE TABLE IF NOT EXISTS Deposits ( \
  id INTEGER PRIMARY KEY AUTOINCREMENT, \
  sender VARCHAR(42), \
  oldToken VARCHAR(42), \
  fee INTEGER, \
  hash VARCHAR(66), \
  senderR VARCHAR(66), \
  senderS VARCHAR(66), \
  senderV TINYINT(1), \
  toChain VARCHAR(66), \
  fromChain VARCHAR(66), \
  amount INTEGER, \
  relayId INTEGER, \
  timestamp INTEGER, \
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP \
)';

const createRelays = 'CREATE TABLE IF NOT EXISTS Relays ( \
  id INTEGER PRIMARY KEY AUTOINCREMENT, \
  sender VARCHAR(64), \
  toChain VARCHAR(64), \
  fromChain VARCHAR(64), \
  amount INTEGER, \
  depositId INTEGER, \
  timestamp INTEGER, \
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP \
)';

exports.deposit = deposit;
exports.getDeposits = getDeposits;
exports.createDeposits = createDeposits;
exports.createRelays = createRelays;
