import { Contract } from '@algorandfoundation/tealscript';

const TOKEN_SUPPLY = 4000000_00000000;
const MINER_REWARD = 1_04857600;
const TOKEN_DECIMALS = 8;
const BLOCKS_TIMEOUT = 5;
const LAST_HALVING = 16;
const NOTE =
  "John Alan Woods 01/Dec/2023 You know, I can pull metrics out of the air too, whatever, 8 million transactions over the last week, I don't know, my mom has four oranges.";
const IFPS_URL = 'ipfs://QmUitxJuPJJrcuAdAiVdEEpuzGmsELGgAvhLd5FiXRShEu#arc3';
const IFPS_HASH = [
  211, 253, 81, 190, 46, 232, 194, 177, 122, 122, 232, 38, 211, 73, 192, 223,
  32, 254, 171, 138, 77, 104, 3, 3, 64, 28, 116, 21, 96, 195, 36, 54,
] as StaticArray<uint<8>, 32>;
// testnet: 1702857600
// mainnet: 1704067200
const START_TIMESTAMP = 1704067200;

class OrangeCoin extends Contract {
  token = GlobalStateKey<Asset>({ key: 'token' });
  block = GlobalStateKey<number>({ key: 'block' });

  totalEffort = GlobalStateKey<number>({ key: 'total_effort' });
  totalTransactions = GlobalStateKey<number>({ key: 'total_transactions' });

  halving = GlobalStateKey<number>({ key: 'halving' });
  halvingSupply = GlobalStateKey<number>({ key: 'halving_supply' });
  minedSupply = GlobalStateKey<number>({ key: 'mined_supply' });
  minerReward = GlobalStateKey<number>({ key: 'miner_reward' });

  lastMiner = GlobalStateKey<Address>({ key: 'last_miner' });
  lastMinerEffort = GlobalStateKey<number>({ key: 'last_miner_effort' });

  currentMiner = GlobalStateKey<Address>({ key: 'current_miner' });
  currentMinerEffort = GlobalStateKey<number>({ key: 'current_miner_effort' });

  startTimestamp = GlobalStateKey<number>({ key: 'start_timestamp' });

  minerEfforts = LocalStateKey<number>({ key: 'effort' });

  @allow.bareCreate()
  createApplication(): void {
    this.token.value = Asset.zeroIndex;
    this.block.value = 0;

    this.totalEffort.value = 0;
    this.totalTransactions.value = 0;

    this.halving.value = 0;
    this.halvingSupply.value = TOKEN_SUPPLY / 2;
    this.minedSupply.value = 0;
    this.minerReward.value = MINER_REWARD;

    this.lastMiner.value = Address.zeroAddress;
    this.lastMinerEffort.value = 0;

    this.currentMiner.value = Address.zeroAddress;
    this.currentMinerEffort.value = 0;

    this.startTimestamp.value = START_TIMESTAMP;
  }

  private createAsset(): void {
    this.token.value = sendAssetCreation({
      configAssetName: 'Orange',
      configAssetUnitName: 'ORA',
      configAssetManager: this.app.address,
      configAssetReserve: this.app.address,
      configAssetFreeze: Address.zeroAddress,
      configAssetClawback: Address.zeroAddress,
      configAssetTotal: TOKEN_SUPPLY,
      configAssetDecimals: TOKEN_DECIMALS,
      configAssetURL: IFPS_URL,
      configAssetMetadataHash: rawBytes(IFPS_HASH),
      fee: 0,
      note: NOTE,
    });
  }

  @allow.bareCall('OptIn')
  useLocalState(): void {
    if (this.token.value === Asset.zeroIndex) {
      this.createAsset();
    }

    this.minerEfforts(this.txn.sender).value = 0;
  }

  private checkBlock(): void {
    const currentBlock = globals.round - (globals.round % BLOCKS_TIMEOUT);

    if (this.block.value !== currentBlock) {
      if (this.lastMiner.value.hasAsset(this.token.value)) {
        const reward =
          this.halvingSupply.value > this.minerReward.value
            ? this.minerReward.value
            : this.halvingSupply.value;

        sendAssetTransfer({
          xferAsset: this.token.value,
          assetReceiver: this.lastMiner.value,
          assetAmount: reward,
        });

        log(concat(this.lastMiner.value, itob(this.lastMinerEffort.value)));

        this.minedSupply.value = this.minedSupply.value + reward;
        this.halvingSupply.value = this.halvingSupply.value - reward;

        if (this.halvingSupply.value === 0) {
          this.halving.value = this.halving.value + 1;

          if (this.halving.value >= LAST_HALVING) {
            this.halvingSupply.value = TOKEN_SUPPLY - this.minedSupply.value;
          } else {
            this.halvingSupply.value =
              (TOKEN_SUPPLY - this.minedSupply.value) / 2;
            this.minerReward.value = this.minerReward.value / 2;
          }
        }
      }

      if (this.lastMiner.value.isOptedInToApp(this.app)) {
        const effort = this.minerEfforts(this.lastMiner.value).value;
        this.minerEfforts(this.lastMiner.value).value =
          effort > this.lastMinerEffort.value
            ? effort - this.lastMinerEffort.value
            : 0;
      }

      this.block.value = currentBlock;
      this.lastMiner.value = this.currentMiner.value;
      this.lastMinerEffort.value = this.currentMinerEffort.value;
      this.currentMinerEffort.value = 0;
    }
  }

  mine(to: Address): void {
    assert(this.minerEfforts(to).exists);
    assert(globals.latestTimestamp >= this.startTimestamp.value);
    assert(this.halving.value <= LAST_HALVING);
    assert(this.txn.fee <= 20000);

    this.checkBlock();

    this.totalEffort.value = this.totalEffort.value + this.txn.fee;
    this.totalTransactions.value = this.totalTransactions.value + 1;

    const totalMinerEffort = this.minerEfforts(to).value + this.txn.fee;
    this.minerEfforts(to).value = totalMinerEffort;

    let currentMinerEffort = totalMinerEffort;
    if (this.lastMiner.value === to) {
      currentMinerEffort =
        currentMinerEffort > this.lastMinerEffort.value
          ? currentMinerEffort - this.lastMinerEffort.value
          : 0;
    }

    if (currentMinerEffort > this.currentMinerEffort.value) {
      this.currentMiner.value = to;
      this.currentMinerEffort.value = currentMinerEffort;
    }
  }
}
