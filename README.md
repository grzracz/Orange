# TEALScript Starter

This package provides a starter template for developing Algorand smart contracts
using the TEALScript programming language. It includes scripts for compiling,
deploying, and interacting with smart contracts.

## Prerequisites

Before using this package, ensure that you have the following prerequisites
installed:

- Node.js (v18 or later)
- Yarn package manager (v1.22 or later)

## Getting Started

1. Clone this repository to your local machine.
2. Install the package dependencies by running `yarn install`.
3. Customize the `.env` file with the appropriate environment variables for your
   deployment.
4. Edit TEALScript template to your unique use-case.
5. Compile the TEALScript contract by running `yarn compile`.
6. Deploy the contract to the Algorand testnet by running `yarn deploy testnet`.
7. Interact with the deployed contract using the provided scripts. For example,
   you can call a contract method by running
   `yarn call testnet <app_id> <method_name>`.

## Example results

### 1) `yarn compile`

```
yarn run v1.22.19
$ bash ./scripts/compile.sh
Compiling ./Contract.algo.ts...
Compiled files were saved to /build
Done in 0.92s.
```

### 2) `yarn deploy testnet 1 1 0 0`

```
yarn run v1.22.19
$ yarn compile && bash ./scripts/deploy.sh testnet 1 1 0 0
$ bash ./scripts/compile.sh
Compiling ./Contract.algo.ts...
Compiled files were saved to /build
Compiled approval program.
Compiled clear program.
Deploying to testnet...
App deployed successfully. App ID:
    253077467 (https://testnet.algoscan.app/app/253077467)
Done in 8.22s.
```

### 3) `yarn call testnet 253077467 increment`

```
yarn run v1.22.19
$ bash ./scripts/call.sh testnet 253077467 increment
Calling 253077467 on testnet - method "increment" with no arguments.
Call successful.
Done in 6.05s.
```

### 4) `yarn call testnet 253077467 delete`

```
yarn run v1.22.19
$ bash ./scripts/call.sh testnet 253077467 delete
App 253077467 deleted successfully.
Done in 7.20s.
```

## Scripts

The package includes the following scripts:

- `compile`: Compiles the TEALScript contract and saves the compiled files to
  the `build` directory.
- `deploy <network>`: Deploys the contract to the specified network (e.g.
  `local`, `testnet`, `mainnet`). In order to deploy, you will be asked to
  specify numGlobalByteSlices etc.
- `call <network> <app_id> <method_name> [args...]`: Calls a method on the
  deployed contract with the specified network, app ID, method name, and
  optional arguments.

Please note that you may need to provide additional configuration or parameters
depending on your specific use case.

## Troubleshooting

If you encounter any issues or errors during the deployment or interaction
process, please refer to the error messages and ensure that you have met the
prerequisites and configured the environment variables correctly.

For further assistance, you can consult the official Algorand documentation or
seek help from the Algorand community here:

[Algorand Discord #TEALScript channel](https://discord.com/channels/491256308461207573/1092416216431329281)

## License

This package is licensed under the [MIT License](LICENSE). Feel free to modify
and use it according to your needs.
