let transactionsToMake = 256;
let totalSpent = 0;
let remaining = 500000;

const fees = [];

console.log('To spend:', remaining / Math.pow(10, 6), 'ALGO');

while (remaining > 0 && transactionsToMake > 0) {
  let fee = Math.floor(remaining / transactionsToMake);

  if (transactionsToMake === 256 && fee < 2000) {
    fee = 2000;
  }

  if (fee < 1000) {
    fee = 1000;
  }

  if (remaining < 1000 + fee) {
    fee = remaining;
  }

  fees.push(fee);

  transactionsToMake -= 1;
  remaining -= fee;
}

console.log('Fees:', [
  ...fees.slice(0, 10),
  '...',
  ...fees.slice(fees.length - 10),
]);
console.log('Total txns:', fees.length);
