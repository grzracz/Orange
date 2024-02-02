let transactionsToMake = 256;
let totalSpent = 0;
let remaining = 500000;

const fees = [];

let prices = new Array(10).fill(0);

function insert(price: number) {
  if (price < prices[0]) {
    // price is lower than all in the array
    // move the array to the right, remove last element
    // insert new price at the start
    prices = [price, ...prices.slice(0, 9)];
  } else if (price >= prices[9]) {
    // price is higher than all in the array
    // move the array to the left, remove first element
    // insert new price at the end
    prices = [...prices.slice(1), price];
  } else {
    // insert price right before first higher element
    for (let i = 1; i < 10; i = i + 1) {
      if (price <= prices[i]) {
        prices = [...prices.slice(1, i), price, ...prices.slice(i)];
        break;
      }
    }
  }
}

let price = 1000;

function addNumber() {
  price += Math.random() * 20 - 10;
  insert(price);
  console.log(price, prices[2], (price / prices[2]).toFixed(2), prices);

  setTimeout(addNumber, 1000);
}

addNumber();