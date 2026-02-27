const tradeHistoryData = {
  order: [
    {
      time: "2026-02-21 12:10:45",
      pair: "BTC/USDT",
      type: "Limit",
      side: "Buy",
      price: "67,774.79",
      amount: "0.250000",
      filled: "100%",
      status: "Filled",
    },
    {
      time: "2026-02-21 11:05:12",
      pair: "ETH/USDT",
      type: "Market",
      side: "Sell",
      price: "3,512.20",
      amount: "1.500000",
      filled: "100%",
      status: "Filled",
    },
    {
      time: "2026-02-20 23:45:00",
      pair: "BTC/USDT",
      type: "Limit",
      side: "Buy",
      price: "66,900.00",
      amount: "0.100000",
      filled: "0%",
      status: "Canceled",
    },
  ],
  trade: [
    {
      time: "2026-02-21 12:10:45",
      pair: "BTC/USDT",
      side: "Buy",
      price: "67,774.79",
      executed: "0.250000",
      fee: "0.00025 BTC",
      total: "16,943.69 USDT",
    },
    {
      time: "2026-02-21 11:05:12",
      pair: "ETH/USDT",
      side: "Sell",
      price: "3,512.20",
      executed: "1.500000",
      fee: "5.26 USDT",
      total: "5,268.30 USDT",
    },
    {
      time: "2026-02-21 09:15:22",
      pair: "SOL/USDT",
      side: "Buy",
      price: "145.10",
      executed: "10.000000",
      fee: "0.01 SOL",
      total: "1,451.00 USDT",
    },
  ],
  transaction: [
    {
      time: "2026-02-21 08:00:00",
      asset: "USDT",
      type: "Deposit",
      amount: "+50,000.00",
      status: "Completed",
      details: "0x742d...44e",
    },
    {
      time: "2026-02-20 15:30:45",
      asset: "BTC",
      type: "Withdrawal",
      amount: "-0.500000",
      status: "Completed",
      details: "bc1qxy...89z",
    },
    {
      time: "2026-02-19 10:00:00",
      asset: "USDT",
      type: "Transfer",
      amount: "10,000.00",
      status: "Completed",
      details: "Spot to Margin",
    },
  ],
};

const tableConfig = {
  order: {
    headers: ["Time", "Pair", "Type", "Side", "Price", "Amount", "Filled", "Status"],
    renderRow: (row) => `
      <tr>
        <td>${row.time}</td>
        <td>${row.pair}</td>
        <td>${row.type}</td>
        <td class="${row.side.toLowerCase()}">${row.side}</td>
        <td>${row.price}</td>
        <td>${row.amount}</td>
        <td>${row.filled}</td>
        <td>${row.status}</td>
      </tr>`,
  },
  trade: {
    headers: ["Time", "Pair", "Side", "Price", "Executed", "Fee", "Total"],
    renderRow: (row) => `
      <tr>
        <td>${row.time}</td>
        <td>${row.pair}</td>
        <td class="${row.side.toLowerCase()}">${row.side}</td>
        <td>${row.price}</td>
        <td>${row.executed}</td>
        <td><span class="fee-pill">${row.fee}</span></td>
        <td>${row.total}</td>
      </tr>`,
  },
  transaction: {
    headers: ["Time", "Asset", "Type", "Amount", "Status", "Details"],
    renderRow: (row) => {
      const amountClass = row.amount.startsWith("+")
        ? "buy"
        : row.amount.startsWith("-")
          ? "sell"
          : "";
      return `
      <tr>
        <td>${row.time}</td>
        <td><strong>${row.asset}</strong></td>
        <td>${row.type}</td>
        <td class="${amountClass}">${row.amount}</td>
        <td>${row.status}</td>
        <td class="details">${row.details}</td>
      </tr>`;
    },
  },
};

function renderTab(tabName) {
  const head = document.getElementById("table-head");
  const body = document.getElementById("table-body");
  const currentConfig = tableConfig[tabName];
  const currentRows = tradeHistoryData[tabName];

  head.innerHTML = currentConfig.headers.map((title) => `<th>${title}</th>`).join("");
  body.innerHTML = currentRows.map((row) => currentConfig.renderRow(row)).join("");

  body.classList.remove("fade-in");
  // Force reflow so fade-in can replay on each tab switch.
  void body.offsetWidth;
  body.classList.add("fade-in");
}

document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".tab");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      renderTab(tab.dataset.tab);
    });
  });

  renderTab("order");
});
