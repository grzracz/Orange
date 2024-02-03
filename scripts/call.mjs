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

function config(contract, app_id, atc, suggestedParams) {
  atc.addMethodCall({
    appID: app_id,
    method: contract.getMethodByName('updateConfig'),
    methodArgs: [100000, 20000, 10000],
    appForeignAssets: [1284444444, 1294765516],
    appForeignApps: [1284326447],
    boxes: [
      {
        appIndex: app_id,
        name: Uint8Array.from([112]),
      },
    ],
    sender: creator.addr,
    signer,
    suggestedParams,
  });
}

async function update(app_id, atc, suggestedParams) {
  const buildDir = path.join(__dirname, '../build/');
  const files = fs.readdirSync(buildDir);
  const approvalFile = files.find(file => file.endsWith('approval.teal'));
  const clearFile = files.find(file => file.endsWith('clear.teal'));

  if (!approvalFile || !clearFile) {
    throw new Error(`Could not find build files. Did you run yarn compile?`);
  }

  const approvalProgram = fs.readFileSync(
    path.join(buildDir, approvalFile),
    'utf8',
  );

  const clearProgram = fs.readFileSync(path.join(buildDir, clearFile), 'utf8');

  const approvalCompileResp = await algodClient
    .compile(Buffer.from(approvalProgram))
    .do();

  const compiledApprovalProgram = new Uint8Array(
    Buffer.from(approvalCompileResp.result, 'base64'),
  );

  console.log(
    `Compiled approval program: ${compiledApprovalProgram.length} bytes`,
  );

  const clearCompileResp = await algodClient
    .compile(Buffer.from(clearProgram))
    .do();

  const compiledClearProgram = new Uint8Array(
    Buffer.from(clearCompileResp.result, 'base64'),
  );

  atc.addTransaction({
    txn: algosdk.makeApplicationUpdateTxnFromObject({
      appIndex: app_id,
      from: creator.addr,
      approvalProgram: compiledApprovalProgram,
      clearProgram: compiledClearProgram,
      suggestedParams,
    }),
    signer,
  });
}

function deposit(contract, app_id, atc, suggestedParams, amount) {
  atc.addTransaction({
    txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: creator.addr,
      to: algosdk.getApplicationAddress(app_id),
      amount: amount,
      suggestedParams,
    }),
    signer,
  });
  atc.addMethodCall({
    appID: app_id,
    method: contract.getMethodByName('deposit'),
    sender: creator.addr,
    boxes: [
      {
        appIndex: app_id,
        name: algosdk.decodeAddress(creator.addr).publicKey,
      },
      {
        appIndex: app_id,
        name: Uint8Array.from([112]),
      },
    ],
    appForeignAssets: [1284444444, 1294765516],
    signer,
    suggestedParams,
  });
}

function withdraw(
  contract,
  app_id,
  atc,
  suggestedParams,
  rewardsBps,
  depositBps,
) {
  suggestedParams.flatFee = true;
  suggestedParams.fee = 3000;
  atc.addMethodCall({
    appID: app_id,
    method: contract.getMethodByName('withdraw'),
    sender: creator.addr,
    methodArgs: [rewardsBps, depositBps],
    appForeignAssets: [1294765516],
    boxes: [
      {
        appIndex: app_id,
        name: algosdk.decodeAddress(creator.addr).publicKey,
      },
    ],
    signer,
    suggestedParams,
  });
}

let index = 0;

function mine(contract, app_id, atc, suggestedParams, lastMiner) {
  suggestedParams.flatFee = true;
  suggestedParams.fee = 1000;
  index = (index + 1) % 256;
  atc.addMethodCall({
    appID: app_id,
    method: contract.getMethodByName('mine'),
    sender: creator.addr,
    appForeignApps: [1284326447, 1002541853],
    appForeignAssets: [1284444444, 1294765516],
    appAccounts: [
      'TRCEY5UZGTATGTF5K3U42IMDT467D4EHV7S5MYJBMLMYARYJOZFATORMUM',
      lastMiner,
    ],
    boxes: [
      {
        appIndex: app_id,
        name: algosdk.decodeAddress(creator.addr).publicKey,
      },
      {
        appIndex: app_id,
        name: Uint8Array.from([112]),
      },
    ],
    note: Uint8Array.from([index]),
    signer,
    suggestedParams,
  });
}

async function main() {
  const app_id = Number.parseInt(process.argv[2]);
  const atc = new algosdk.AtomicTransactionComposer();
  const abi = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../build/OrangeMiner.arc4.json'),
      'utf8',
    ),
  );

  const contract = new algosdk.ABIContract(abi);
  const suggestedParams = await algodClient.getTransactionParams().do();

  const miningApp = await algodClient.getApplicationByID(1284326447).do();
  const globalState = miningApp.params['global-state'];
  const lastMinerKv = globalState.find(
    kv => Buffer.from(kv.key, 'base64').toString() === 'last_miner',
  );
  const lastMiner = algosdk.encodeAddress(
    Buffer.from(lastMinerKv.value.bytes, 'base64'),
  );

  await update(app_id, atc, suggestedParams);
  // config(contract, app_id, atc, suggestedParams);
  // deposit(contract, app_id, atc, suggestedParams, 200000000);
  // withdraw(contract, app_id, atc, suggestedParams, 10000, 10000);
  // mine(contract, app_id, atc, suggestedParams, lastMiner);

  console.log(`Calling ${app_id} on ${process.env.NETWORK}...`);
  atc.execute(algodClient, 4).catch(e => console.error(e));
  // setTimeout(main, 1000);
}

main();
