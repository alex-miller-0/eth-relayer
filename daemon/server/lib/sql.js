// SQL interface and common Functions
const Promise = require('bluebird').Promise;
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('Relayer.db');
const commands = require('./sqlCommands.js');

// Boot up and create tables
db.serialize(() => {
  db.run(commands.createDeposits);
  db.run(commands.createRelays);
})

function run(data, f) {
  return new Promise((resolve, reject) => {
    const cmd = f(data);
    db.run(cmd);
    return resolve(true);
  })
}

function query(data, f) {
  return new Promise((resolve, reject) => {
    let rows = [];
    const cmd = f(data);

    db.all(cmd, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows);
    })
  })
}

exports.run = run;
exports.query = query;
