# TrustedRelay EPM Package

This is a contract to relay ERC20 and ERC721 tokens between chains. This requires a trusted relayer to create (or unlock) tokens on the desired chain.

All chains are identified by `chainId`, which can be found with `net.version` in your web3 console.

## Installation

If you would like to run this contract from this repo and run tests, you can get set up with:

```
truffle install tokens
truffle compile
truffle test
```

## Usage

To use this package in your truffle project, install with:

```
truffle install TrustedRelay
```
