import { Contract } from '@algorandfoundation/tealscript';

// tealscript 0.80.0

const BOX_SIZE = 5 * 8 + 2 * 16;
const BOX_COST = 2500 + BOX_SIZE * 400 + 32 * 400;

type MinerBalance = {
  deposited: number;
  depositedAt: number;
  spentPerToken: uint128;
  rewardPerToken: uint128;
  totalSpent: number;
  totalWithdrawn: number;
  claimable: number;
};

const SCALE = 18446744073709551615;

class OrangeMiner extends Contract {
  manager = GlobalStateKey<Address>();

  miningApplication = GlobalStateKey<Application>();
  miningToken = GlobalStateKey<Asset>();
  poolAddress = GlobalStateKey<Address>();
  poolApplication = GlobalStateKey<Application>();
  poolToken = GlobalStateKey<Asset>();
  minDeposit = GlobalStateKey<number>();
  baseTxnFee = GlobalStateKey<number>();
  marketRateBps = GlobalStateKey<number>();

  // ALGO deposits for use in LP and mining
  totalDeposited = GlobalStateKey<number>();
  // ALGO spent so far from deposits
  totalSpent = GlobalStateKey<number>();
  // LP withdrawn so far
  totalWithdrawn = GlobalStateKey<number>();
  // total mined so far, updated on LP deposits
  totalMined = GlobalStateKey<number>();

  // ALGO spent at time of last update (for delta)
  lastSpent = GlobalStateKey<number>();
  // LP rewards at time of last update (for delta)
  lastRewards = GlobalStateKey<number>();

  // staking perToken for ALGO spent
  spentPerToken = GlobalStateKey<uint128>();
  // staking perToken for rewards
  rewardPerToken = GlobalStateKey<uint128>();

  lastPriceRound = GlobalStateKey<number>();

  prices = BoxKey<StaticArray<uint128, 10>>({ key: 'p' });

  balances = BoxMap<Address, MinerBalance>();

  @allow.bareCreate()
  createApplication(): void {
    this.manager.value = this.txn.sender;
    this.miningApplication.value = Application.fromID(1284326447);
    this.miningToken.value = Asset.fromID(1284444444);
    this.poolAddress.value = addr(
      'TRCEY5UZGTATGTF5K3U42IMDT467D4EHV7S5MYJBMLMYARYJOZFATORMUM',
    );
    this.poolApplication.value = Application.fromID(1002541853);
    this.poolToken.value = Asset.fromID(1294765516);
    this.minDeposit.value = 100_000;
    this.baseTxnFee.value = 20_000;
    this.marketRateBps.value = 10500;

    this.totalDeposited.value = 0;
    this.totalSpent.value = 0;
    this.totalWithdrawn.value = 0;

    this.lastSpent.value = 0;
    this.lastRewards.value = 0;

    this.spentPerToken.value = 0 as uint128;
    this.rewardPerToken.value = 0 as uint128;

    this.lastPriceRound.value = 0;
  }

  @allow.bareCall('UpdateApplication')
  updateApplication(): void {
    assert(this.txn.sender === this.manager.value);
  }

  updateConfig(
    minDeposit: number,
    baseTxnFee: number,
    marketRateBps: number,
  ): void {
    assert(this.txn.sender === this.manager.value);
    assert(baseTxnFee >= globals.minTxnFee);
    assert(baseTxnFee <= 20_000);
    assert(minDeposit <= 1_000_000);
    assert(minDeposit >= 50_000);
    assert(marketRateBps <= 20000);

    if (!this.prices.exists) this.prices.create(160);
    if (!this.app.address.isOptedInToAsset(this.miningToken.value)) {
      sendAssetTransfer({
        xferAsset: this.miningToken.value,
        assetReceiver: this.app.address,
        assetAmount: 0,
        fee: 0,
      });
      sendAppCall({
        applicationID: this.miningApplication.value,
        onCompletion: OnCompletion.OptIn,
        fee: 0,
      });
      sendAssetTransfer({
        xferAsset: this.poolToken.value,
        assetReceiver: this.app.address,
        assetAmount: 0,
        fee: 0,
      });
    }

    this.minDeposit.value = minDeposit;
    this.baseTxnFee.value = baseTxnFee;
    this.marketRateBps.value = marketRateBps;
  }

  private updatePerToken(): void {
    if (this.totalDeposited.value > 0) {
      const scale = SCALE as uint128;
      const recentlySpent = (this.totalSpent.value -
        this.lastSpent.value) as uint128;

      const currentRewards =
        this.app.address.assetBalance(this.poolToken.value) +
        this.totalWithdrawn.value;
      const recentlyRewarded = (currentRewards -
        this.lastRewards.value) as uint128;

      const recentlySpentPerToken =
        (recentlySpent * scale) / (this.totalDeposited.value as uint128);
      const recentlyRewardedPerToken =
        (recentlyRewarded * scale) / (this.totalDeposited.value as uint128);

      this.spentPerToken.value =
        this.spentPerToken.value + recentlySpentPerToken;
      this.rewardPerToken.value =
        this.rewardPerToken.value + recentlyRewardedPerToken;

      this.lastSpent.value = this.totalSpent.value;
      this.lastRewards.value = currentRewards;
    }
  }

  private updateBalance(address: Address, deposit: number): void {
    if (!this.balances(address).exists) {
      this.balances(address).create(BOX_SIZE);
      deposit = deposit - BOX_COST;
    }

    const balance = this.balances(address).value;
    const scale = SCALE as uint128;

    this.totalDeposited.value = this.totalDeposited.value - balance.deposited;

    const spentDelta = (this.spentPerToken.value -
      balance.spentPerToken) as uint128;
    const spentToDate = (((balance.deposited as uint128) * spentDelta) /
      scale) as uint64;
    const rewardsDelta = (this.rewardPerToken.value -
      balance.rewardPerToken) as uint128;
    const rewardsToDate = (((balance.deposited as uint128) * rewardsDelta) /
      scale) as uint64;

    // if spent > deposited, this will fail
    balance.deposited = balance.deposited + deposit - spentToDate;
    balance.claimable = balance.claimable + rewardsToDate;
    balance.depositedAt = globals.latestTimestamp;
    balance.spentPerToken = this.spentPerToken.value;
    balance.rewardPerToken = this.rewardPerToken.value;
    balance.totalSpent = balance.totalSpent + spentToDate;

    this.totalDeposited.value = this.totalDeposited.value + balance.deposited;
  }

  deposit(): void {
    assert(this.txn.groupIndex > 0);
    const payment = this.txnGroup[this.txn.groupIndex - 1];
    assert(payment.typeEnum === TransactionType.Payment);
    assert(payment.receiver === this.app.address);

    this.updatePerToken();
    this.updateBalance(this.txn.sender, payment.amount);
  }

  private sendRewards(from: Address, to: Address, bps: number): void {
    const balance = this.balances(from).value;
    const toSend = wideRatio([balance.claimable, bps], [10000]);

    if (toSend > 0) {
      sendAssetTransfer({
        xferAsset: this.poolToken.value,
        assetReceiver: to,
        assetAmount: toSend,
        fee: 0,
      });

      this.totalWithdrawn.value = this.totalWithdrawn.value + toSend;
      balance.totalWithdrawn = balance.totalWithdrawn + toSend;
      balance.claimable = balance.claimable - toSend;
    }
  }

  private returnDeposit(from: Address, to: Address, bps: number): void {
    const balance = this.balances(from).value;
    const toSend = wideRatio([balance.deposited, bps], [10000]);

    if (toSend > 1) {
      sendPayment({
        receiver: to,
        amount: toSend - 1,
        fee: 0,
      });
    }

    this.totalDeposited.value = this.totalDeposited.value - toSend;
    balance.deposited = balance.deposited - toSend;
  }

  withdraw(rewardsBps: number, depositBps: number): void {
    assert(rewardsBps <= 10000);
    assert(depositBps <= 10000);

    this.updatePerToken();
    this.updateBalance(this.txn.sender, 0);
    this.sendRewards(this.txn.sender, this.txn.sender, rewardsBps);
    this.returnDeposit(this.txn.sender, this.txn.sender, depositBps);
  }

  repay(address: Address): void {
    assert(this.txn.groupIndex > 0);
    const payment = this.txnGroup[this.txn.groupIndex - 1];
    assert(payment.typeEnum === TransactionType.Payment);
    assert(payment.receiver === this.app.address);

    this.updatePerToken();

    const balance = this.balances(address).value;
    const scale = SCALE as uint128;

    const totalDeposit = payment.amount + balance.deposited;
    const spentDelta = (this.spentPerToken.value -
      balance.spentPerToken) as uint128;
    const spent = (((balance.deposited as uint128) * spentDelta) /
      scale) as uint64;
    assert(spent + this.minDeposit.value > balance.deposited);
    assert(spent < totalDeposit);
    let rewardsKeptBps = wideRatio([balance.deposited, 10000], [spent]);
    if (rewardsKeptBps > 10000) rewardsKeptBps = 10000;

    this.updateBalance(address, payment.amount);
    this.returnDeposit(address, this.txn.sender, 10000);
    this.sendRewards(address, this.txn.sender, 10000 - rewardsKeptBps);
  }

  private updatePrice(): uint128 {
    const roundDifference = globals.round - this.lastPriceRound.value;
    const scale = SCALE as uint128;
    // ORA in pool
    const reservesA = this.poolApplication.value.localState(
      this.poolAddress.value,
      'asset_1_reserves',
    ) as uint64;
    // ALGO in pool
    const reservesB = this.poolApplication.value.localState(
      this.poolAddress.value,
      'asset_2_reserves',
    ) as uint64;
    const price = ((reservesB as uint128) * scale) / (reservesA as uint128);
    // insert price into history at most once per round
    if (roundDifference > 0) {
      // if contract stopped juicing, clear the price history
      if (roundDifference > 10) {
        this.prices.value = castBytes<StaticArray<uint128, 10>>(bzero(160));
      }
      if (price < this.prices.value[0]) {
        // price is lower than all in the array
        // move the array to the right, remove last element
        // insert new price at the start
        this.prices.value = castBytes<StaticArray<uint128, 10>>(
          rawBytes(price) + extract3(rawBytes(this.prices.value), 0, 144),
        );
      } else if (price >= this.prices.value[9]) {
        // price is higher than all in the array
        // move the array to the left, remove first element
        // insert new price at the end
        this.prices.value = castBytes<StaticArray<uint128, 10>>(
          extract3(rawBytes(this.prices.value), 16, 144) + rawBytes(price),
        );
      } else {
        // insert price right before first higher element
        for (let i = 1; i < 10; i = i + 1) {
          if (price <= this.prices.value[i]) {
            const index = 16 * i;
            this.prices.value = castBytes<StaticArray<uint128, 10>>(
              extract3(rawBytes(this.prices.value), 16, index - 16) +
                rawBytes(price) +
                extract3(rawBytes(this.prices.value), index, 160 - index),
            );
            break;
          }
        }
      }
    }
    this.lastPriceRound.value = globals.round;
    return price;
  }

  private addLiquidity(amountA: number, amountB: number): void {
    this.pendingGroup.addAssetTransfer({
      xferAsset: this.miningToken.value,
      assetAmount: amountA,
      assetReceiver: this.poolAddress.value,
      fee: 0,
      isFirstTxn: true,
    });
    this.pendingGroup.addPayment({
      amount: amountB,
      receiver: this.poolAddress.value,
      fee: 0,
    });
    this.pendingGroup.addAppCall({
      applicationID: this.poolApplication.value,
      applicationArgs: ['add_liquidity', 'flexible', itob(0)],
      assets: [this.poolToken.value],
      accounts: [this.poolAddress.value],
      fee: 0,
    });
    this.pendingGroup.submit();
    this.totalSpent.value = this.totalSpent.value + amountB;
  }

  mine(): void {
    // ensure not already winning
    const block = globals.round - (globals.round % 5);
    const isNewBlock =
      block !== (this.miningApplication.value.globalState('block') as uint64);
    const currentMiner = Address.fromBytes(
      this.miningApplication.value.globalState('current_miner') as bytes,
    );
    assert(isNewBlock || this.app.address !== currentMiner);

    // expand budget
    let expandCost = globals.minTxnFee;
    let totalTransactions = 3;
    if (isNewBlock) {
      expandCost = expandCost + globals.minTxnFee;
      totalTransactions = totalTransactions + 1;
    }
    sendMethodCall<[Address], void>({
      applicationID: this.miningApplication.value,
      fee: expandCost,
      name: 'mine',
      methodArgs: [this.app.address],
    });
    this.totalSpent.value = this.totalSpent.value + expandCost;

    const currentPrice = this.updatePrice();
    const medianPrice = this.prices.value[4];
    const scale = SCALE as uint128;

    const minerReward = this.miningApplication.value.globalState(
      'miner_reward',
    ) as uint64;
    const marketEffort = (((this.marketRateBps.value as uint128) *
      (minerReward as uint128) *
      medianPrice) /
      ((10000 as uint128) * scale)) as uint64;
    const currentMinerEffort = isNewBlock
      ? 0
      : (this.miningApplication.value.globalState(
          'current_miner_effort',
        ) as uint64);
    const lastMiner = this.miningApplication.value.globalState(
      'last_miner',
    ) as Address;
    const lastMinerEffort = this.miningApplication.value.globalState(
      'last_miner_effort',
    ) as uint64;
    // current app effort
    let currentEffort = this.miningApplication.value.localState(
      this.app.address,
      'effort',
    ) as uint64;
    // deduct already spent effort, as the mining app does
    if (lastMiner === this.app.address) {
      currentEffort = currentEffort - lastMinerEffort;
    }
    // beat the current miner
    let desiredEffort = currentMinerEffort + 1;
    // but only if it's not too high
    if (marketEffort < desiredEffort) {
      desiredEffort = marketEffort;
    }
    // refund tx + at least one juicing tx
    let toSpend = 2 * globals.minTxnFee;

    const minedRewards = this.app.address.assetBalance(this.miningToken.value);
    const minPrice = ((95 as uint128) * medianPrice) / (100 as uint128);
    const maxPrice = ((105 as uint128) * medianPrice) / (100 as uint128);
    const addLiquidity =
      minedRewards > 0 && minPrice < currentPrice && maxPrice > currentPrice;
    if (addLiquidity) {
      toSpend = toSpend + 5 * globals.minTxnFee;
      totalTransactions = totalTransactions + 5;
    }

    if (desiredEffort > currentEffort + toSpend) {
      toSpend = desiredEffort - currentEffort;
    }

    while (toSpend > 0 && totalTransactions < 256) {
      totalTransactions = totalTransactions + 1;

      let fee =
        toSpend > this.baseTxnFee.value ? this.baseTxnFee.value : toSpend;

      if (
        totalTransactions !== 256 &&
        fee !== toSpend &&
        toSpend < globals.minTxnFee + fee
      ) {
        fee = fee - globals.minTxnFee;
      }

      toSpend = toSpend - fee;
      this.totalSpent.value = this.totalSpent.value + fee;

      sendMethodCall<[Address], void>({
        applicationID: this.miningApplication.value,
        fee: fee,
        name: 'mine',
        methodArgs: [this.app.address],
      });
    }

    // refund the caller with one min fee
    sendPayment({
      receiver: this.txn.sender,
      amount: globals.minTxnFee,
      fee: 0,
    });
    this.totalSpent.value = this.totalSpent.value + globals.minTxnFee;

    if (addLiquidity) {
      this.addLiquidity(
        minedRewards,
        (((minedRewards as uint128) * currentPrice) / scale) as uint64,
      );
    }
  }
}
