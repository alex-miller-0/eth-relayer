# TrustedRelay

This is a contract to relay ERC20 and ERC721 tokens between chains. This requires a trusted relayer to create (or unlock) tokens on the desired chain.

All chains are identified by `chainId`, which can be found with `net.version` in your web3 console.

## Installation

If you would like to run this contract from this repo and run tests, you can get set up with:

```
npm install
truffle install tokens
```

## Configuration

Configuration is done in two files: `truffle.js` and `secrets.json`.

A minimal `truffle.js` file would look like this:

```
module.exports = {
  networks: {
    development: {
      host: 'localhost',
      port: 7545,
      network_id: '*', // Match any network id
    },
  },
};
```

I use [Ganache](https://github.com/trufflesuite/ganache/releases) for my primary test chain, which runs on port 7545 by default.

Your `secrets.json` must contain a `mnemonic` and a `hdPath`:

```
{
  "mnemonic": "public okay smoke segment forum front animal extra appear online before various cook test arrow",
  "hdPath": "m/44'/60'/0'/0/"
}
```

You can generate a new BIP39 mnemonic [here](https://coinomi.com/recovery-phrase-tool.html). Do not change `hdPath` unless you have a good reason to - changing it will brea the tests.

## Testing

In order to run the tests, you will need two local blockchains running. Assuming you already have Ganache running on port 7545, you can start a new testrpc instance on port 7546 with:

```
testrpc -p 7546 -m "public okay smoke segment forum front animal extra appear online before various cook test arrow"
```

*Note: the mnemonic (`-m`) must be the same as the one in your `secrets.json` file and it must also be the same one that seeded your Ganache chain (to change, click on the settings gear and go to accounts & keys).*

You can now run the tests with:

```
npm run test
```

## (react app) Exporting config

If you wish to test this with the [front-end react app](https://github.com/alex-miller-0/trusted-relay-app), you can setup a config file to load. Choose your test networks (you need two) and run the following:

```
npm run gen-config <origin port> <destination port>
```
If you don't want to use localhost ports, you can replace either port in the above command with the full URL of your network.

*NOTE: If you reboot TestRPC, you will need to regenerate this file with `npm run gen-config`. TestRPC assigns a random network_id value, so if you are connected to trusted-relay-app, that will break!*

This will generate a file in your repo's root called `networks.json`, which will look like this:

```
{
  "networks": {
    "5777": {
      "name": "Origin",
      "value": "",
      "gateway": "http://localhost:7545"
    },
    "1512850781666": {
      "name": "Destination",
      "value": "",
      "gateway": "http://localhost:7546"
    }
  }
}
```

The `value`s correspond to a Gateway contract address, which serves as the chain identifier in the relay network. You can generate values for these automatically by running:

```
npm run test
```

## Usage

*NOTE: This is meant to be an [EPM](http://ethpm.com) package, but there is currently a [bug](https://github.com/trufflesuite/truffle/issues/699) in publishing packages with dependencies - I am waiting on resolution.*

To use this package in your truffle project, install with:

```
truffle install TrustedRelay
```
