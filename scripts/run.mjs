import algosdk from 'algosdk';
import path from 'path';
import fs, { stat } from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runner_mnemonic = process.env.DEPLOYER_MNEMONIC;
const algod_address = process.env.ALGOD_SERVER;
const algodClient = new algosdk.Algodv2(
  process.env.ALGOD_TOKEN,
  algod_address,
  process.env.ALGOD_PORT,
  { 'User-Agent': 'orange-pool-miner' },
);

const runner = algosdk.mnemonicToSecretKey(runner_mnemonic);
const signer = algosdk.makeBasicAccountTransactionSigner(runner);

let index = 0;
let lastMiner = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
let suggestedParams = null;

let transactionsSent = 0;

async function mine(contract, app_id) {
  try {
    const atc = new algosdk.AtomicTransactionComposer();

    if (index % 10 === 0) {
      console.log(`Transactions sent: ${transactionsSent}`);
      suggestedParams = await algodClient.getTransactionParams().do();
      suggestedParams.flatFee = true;
      suggestedParams.fee = 1000;
      const miningApp = await algodClient.getApplicationByID(1284326447).do();
      const globalState = miningApp.params['global-state'];
      const lastMinerKv = globalState.find(
        kv => Buffer.from(kv.key, 'base64').toString() === 'last_miner',
      );
      lastMiner = algosdk.encodeAddress(
        Buffer.from(lastMinerKv.value.bytes, 'base64'),
      );
    }

    index = (index + 1) % 250;

    atc.addMethodCall({
      appID: app_id,
      method: contract.getMethodByName('mine'),
      sender: runner.addr,
      appForeignApps: [1284326447, 1002541853],
      appForeignAssets: [1284444444, 1294765516],
      appAccounts: [
        'TRCEY5UZGTATGTF5K3U42IMDT467D4EHV7S5MYJBMLMYARYJOZFATORMUM',
        lastMiner,
      ],
      boxes: [
        {
          appIndex: app_id,
          name: Uint8Array.from([112]),
        },
      ],
      note: Uint8Array.from([index]),
      signer,
      suggestedParams,
    });

    await atc.execute(algodClient, 0);
  } catch {}

  transactionsSent += 1;

  setTimeout(() => mine(contract, app_id), 850);
}

const state = {};
const balances = {};
let block = 0;

async function updateAppState(app_id) {
  const contractData = await algodClient.getApplicationByID(app_id).do();
  contractData.params['global-state'].forEach(kv => {
    const key = atob(kv['key']);
    if (['spentPerToken', 'rewardPerToken'].includes(key)) {
      const value = Uint8Array.from(Buffer.from(kv.value.bytes, 'base64'));
      state[key] = algosdk.bytesToBigInt(value);
    } else {
      state[key] = kv.value.type === 1 ? kv.value.bytes : kv.value.uint;
    }
  });
}

const decodeBox = boxData => {
  return {
    deposited: algosdk.decodeUint64(boxData.slice(0, 8)),
    depositedAt: algosdk.decodeUint64(boxData.slice(8, 16)),
    spentPerToken: algosdk.bytesToBigInt(boxData.slice(16, 32)),
    rewardPerToken: algosdk.bytesToBigInt(boxData.slice(32, 48)),
    totalSpent: algosdk.decodeUint64(boxData.slice(48, 56)),
    totalWithdrawn: algosdk.decodeUint64(boxData.slice(56, 64)),
    claimable: algosdk.decodeUint64(boxData.slice(64, 72)),
  };
};

async function liquidate(app_id, contract, address) {
  try {
    console.log(`Liquidating ${address}`);
    const atc = new algosdk.AtomicTransactionComposer();
    const sp = await algodClient.getTransactionParams().do();
    atc.addTransaction({
      txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: runner.addr,
        to: algosdk.getApplicationAddress(app_id),
        amount: 10000000,
        suggestedParams: sp,
      }),
      signer,
    });
    sp.flatFee = true;
    sp.fee = 3000;
    atc.addMethodCall({
      appID: app_id,
      method: contract.getMethodByName('repay'),
      sender: runner.addr,
      appForeignApps: [1284326447, 1002541853],
      appForeignAssets: [1284444444, 1294765516],
      methodArgs: [algosdk.decodeAddress(address).publicKey],
      boxes: [
        {
          appIndex: app_id,
          name: algosdk.decodeAddress(address).publicKey,
        },
      ],
      note: Uint8Array.from([index]),
      signer,
      suggestedParams: sp,
    });

    await atc.execute(algodClient, 0);
  } catch {}
}

const scale = Number('18446744073709551615');

async function checkLiquidations(app_id, contract) {
  const recentlySpent = state.totalSpent - state.lastSpent;
  const recentlySpentPerToken =
    state.totalDeposited > 0
      ? (recentlySpent * scale) / state.totalDeposited
      : 0;
  const spentPerToken = Number(state.spentPerToken) + recentlySpentPerToken;
  Object.keys(balances).forEach(address => {
    const balance = balances[address];
    const spentDelta = spentPerToken - Number(balance.spentPerToken);
    const spentToDate = Math.ceil((balance.deposited * spentDelta) / scale);
    if (
      balance.deposited > 0 &&
      balance.deposited - state.minDeposit < spentToDate
    )
      liquidate(app_id, contract, address);
  });
}

async function updateBalance(app_id, address) {
  if (algosdk.isValidAddress(address)) {
    try {
      console.log(`Updating balance for ${address}`);
      const response = await algodClient
        .getApplicationBoxByName(
          app_id,
          algosdk.decodeAddress(address).publicKey,
        )
        .do();
      balances[address] = decodeBox(response.value);
    } catch {
      console.log(`Failed to update balance for ${address}`);
    }
  }
}

async function catchupBalances(app_id) {
  const boxes = await algodClient.getApplicationBoxes(app_id).do();
  const names = boxes.boxes.map(b => b.name);
  for (let bName of names) {
    await updateBalance(app_id, algosdk.encodeAddress(bName));
  }
}

function onlyUnique(value, index, array) {
  return array.indexOf(value) === index;
}

async function checkBlockBalances(app_id, block) {
  const blockData = await algodClient.block(block).do();
  const transactions = blockData.block.txns;
  const addresses = [];
  transactions.forEach(tx => {
    if (tx.txn['type'] === 'appl' && tx.txn['apid'] === app_id) {
      if (tx.dt.lg) {
        const address = algosdk.encodeAddress(tx.txn.snd);
        if (algosdk.isValidAddress(address)) addresses.push(address);
        const args = tx.txn.apaa;
        args.forEach(arg => {
          const address = algosdk.encodeAddress(arg);
          if (algosdk.isValidAddress(address)) addresses.push(address);
        });
      }
    }
  });
  const filtered = addresses.filter(onlyUnique);
  for (let i = 0; i < filtered.length; i += 5) {
    const chunk = filtered.slice(i, i + 5);
    const promises = [];
    chunk.forEach(a => promises.push(updateBalance(app_id, a)));
    Promise.all(promises);
  }
}

async function getLastBlock() {
  const status = await algodClient.status().do();
  return status['last-round'];
}

async function monitorBalances(app_id, contract) {
  await updateAppState(app_id);
  const lastBlock = getLastBlock();
  while (lastBlock > block) {
    console.log(`Catching up block ${block}`);
    await checkBlockBalances(app_id, block);
    block += 1;
  }
  while (true) {
    console.log(`Checking block ${block}`);
    try {
      await algodClient.statusAfterBlock(block).do();
      await updateAppState(app_id);
      await checkBlockBalances(app_id, block);
      await checkLiquidations(app_id, contract);
      block += 1;
    } catch {
      console.log(`Failed check for block {}`);
    }
  }
}

async function main() {
  block = await getLastBlock();

  const app_id = Number.parseInt(process.argv[2]);

  const abi = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../build/OrangeMiner.arc4.json'),
      'utf8',
    ),
  );
  const contract = new algosdk.ABIContract(abi);

  // starting mining
  console.log(
    `Starting to mine through ${app_id} on ${process.env.NETWORK}...`,
  );
  mine(contract, app_id);

  console.log(`Starting monitoring from round ${block}`);
  await catchupBalances(app_id);
  monitorBalances(app_id, contract);
}

main();
