import algosdk from 'algosdk';
import path from 'path';
import fs from 'fs';

const { DEPLOYER_MNEMONIC, ALGOD_SERVER, ALGOD_TOKEN, ALGOD_PORT } =
  process.env;

const algodClient = new algosdk.Algodv2(
  ALGOD_TOKEN as string,
  ALGOD_SERVER as string,
  ALGOD_PORT as string,
);

const timestamp = ALGOD_SERVER?.includes('testnet') ? 1702857600 : 1704067200;

const creator = algosdk.mnemonicToSecretKey(DEPLOYER_MNEMONIC as string);

async function deploy(name: string, buildPath: string, extras: number[]) {
  const buildDir = path.join(__dirname, buildPath);

  const files = fs.readdirSync(buildDir);

  const approvalFile = files.find(file => file.endsWith('approval.teal'));
  const clearFile = files.find(file => file.endsWith('clear.teal'));

  if (!approvalFile || !clearFile) {
    throw new Error(
      `Could not find build files in ${buildPath}. Did you run yarn compile?`,
    );
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
    `Compiled ${name} approval program: ${compiledApprovalProgram.length} bytes`,
  );

  const clearCompileResp = await algodClient
    .compile(Buffer.from(clearProgram))
    .do();

  const compiledClearProgram = new Uint8Array(
    Buffer.from(clearCompileResp.result, 'base64'),
  );

  console.log(
    `Compiled ${name} clear program: ${compiledClearProgram.length} bytes`,
  );

  console.log(`Deploying ${name} to ${process.env.NETWORK}...`);

  const suggestedParams = await algodClient.getTransactionParams().do();
  suggestedParams.flatFee = true;
  suggestedParams.fee = 2000;

  console.log('Timestamp:', timestamp);
  const appCreateTxn = algosdk.makeApplicationCreateTxnFromObject({
    from: creator.addr,
    approvalProgram: compiledApprovalProgram,
    clearProgram: compiledClearProgram,
    numGlobalByteSlices: extras[0],
    numGlobalInts: extras[1],
    numLocalByteSlices: extras[2],
    numLocalInts: extras[3],
    suggestedParams,
    extraPages: extras[4],
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
  });
  await algodClient.sendRawTransaction(appCreateTxn.signTxn(creator.sk)).do();
  const result = await algosdk.waitForConfirmation(
    algodClient,
    appCreateTxn.txID().toString(),
    3,
  );

  const appId = result['application-index'];
  console.log(
    `App (${name}) deployed successfully. App ID:
    ${appId.toString()} 
    (https://app.dappflow.org/explorer/application/${appId})`,
  );
}

console.log(creator.addr);

deploy('Orange Coin', '../build', [2, 11, 0, 1, 0]).catch(e => {
  console.error(e);
});
