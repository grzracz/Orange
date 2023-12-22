import algosdk from 'algosdk';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const creator_mnemonic = process.env.DEPLOYER_MNEMONIC;
const algod_address = process.env.ALGOD_SERVER;
const algodClient = new algosdk.Algodv2(
  process.env.ALGOD_TOKEN,
  algod_address,
  process.env.ALGOD_PORT,
);

const creator = algosdk.mnemonicToSecretKey(creator_mnemonic);
const signer = algosdk.makeBasicAccountTransactionSigner(creator);

function initContract(app_id, atc, suggestedParams) {
  atc.addTransaction({
    txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: 'ORANGESCU7XMR2TFXSFTOHCUHNP6OYEPIKZW3JZANTCDHVQYMGQFYFIDDA',
      to: algosdk.getApplicationAddress(app_id),
      amount: 200000,
      suggestedParams,
    }),
    signer,
  });
  suggestedParams.flatFee = true;
  suggestedParams.fee = 2000;
  // opt in to app
  atc.addTransaction({
    txn: algosdk.makeApplicationOptInTxnFromObject({
      from: 'ORANGESCU7XMR2TFXSFTOHCUHNP6OYEPIKZW3JZANTCDHVQYMGQFYFIDDA',
      appIndex: app_id,
      suggestedParams,
    }),
    signer,
  });
}

function optInAsset(assetIndex, atc, suggestedParams) {
  atc.addTransaction({
    txn: algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: 'ORANGESCU7XMR2TFXSFTOHCUHNP6OYEPIKZW3JZANTCDHVQYMGQFYFIDDA',
      to: 'ORANGESCU7XMR2TFXSFTOHCUHNP6OYEPIKZW3JZANTCDHVQYMGQFYFIDDA',
      assetIndex: assetIndex,
      amount: 0,
      suggestedParams,
    }),
    signer,
  });
}

function juice(contract, assetIndex, app_id, atc, suggestedParams) {
  suggestedParams.flatFee = true;
  suggestedParams.fee = 2000;

  atc.addMethodCall({
    appID: app_id,
    method: contract.getMethodByName('mine'),
    methodArgs: [
      algosdk.decodeAddress(
        'ORANGESCU7XMR2TFXSFTOHCUHNP6OYEPIKZW3JZANTCDHVQYMGQFYFIDDA',
      ).publicKey,
    ],
    appAccounts: [
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
      'ORANGESCU7XMR2TFXSFTOHCUHNP6OYEPIKZW3JZANTCDHVQYMGQFYFIDDA',
    ],
    appForeignAssets: [assetIndex],
    sender: creator.addr,
    signer,
    suggestedParams,
  });
}

async function mine() {
  const app_id = Number.parseInt(process.argv[2]);
  const atc = new algosdk.AtomicTransactionComposer();
  const abi = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../build/OrangeCoin.arc4.json'),
      'utf8',
    ),
  );

  const contract = new algosdk.ABIContract(abi);
  const suggestedParams = await algodClient.getTransactionParams().do();

  const assetIndex = 17860;
  // initContract(app_id, atc, suggestedParams);
  // optInAsset(assetIndex, atc, suggestedParams);
  juice(contract, assetIndex, app_id, atc, suggestedParams);

  console.log(`Calling ${app_id} on ${process.env.NETWORK}...`);

  await atc.execute(algodClient, 4);

  console.log('Call successful.');

  setTimeout(mine, 500);
}

mine();
