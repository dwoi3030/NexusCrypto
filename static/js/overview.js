document.addEventListener('DOMContentLoaded', function () {
  var holdings = [
    { name: 'Bitcoin', symbol: 'BTC', amount: 0.52, color: '#F7931A' },
    { name: 'Ethereum', symbol: 'ETH', amount: 6.1, color: '#627EEA' },
    { name: 'Solana', symbol: 'SOL', amount: 42.5, color: '#14F195' },
    { name: 'Binance Coin', symbol: 'BNB', amount: 15.0, color: '#F3BA2F' },
  ];

  var assetBody = document.getElementById('assetBody');
  var balanceAmountEl = document.getElementById('balanceAmount');
  var balancePnlEl = document.getElementById('balancePnl');
  var monthlyProfitEl = document.getElementById('monthlyProfit');
  var nextPayoutEl = document.getElementById('nextPayout');
  var toggleBtn = document.getElementById('toggleBalance');
  var chartLineEl = document.getElementById('overviewChartLine');
  var chartFillEl = document.getElementById('overviewChartFill');

  var currentBalanceText = '$0.00';
  var isHidden = false;

  function formatUsd(value) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function formatPct(value) {
    var sign = value >= 0 ? '+' : '';
    return sign + value.toFixed(2) + '%';
  }

  function getNextPayoutText() {
    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth() + 1, 12);
    return 'Next payout: ' + next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function getVisibleIcon() {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  }

  function getHiddenIcon() {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
  }

  async function fetchPrice(symbol) {
    var response = await fetch('/api/market/price/?base=' + encodeURIComponent(symbol) + '&quote=USD');
    var payload = await response.json();
    if (!response.ok || !payload.ok || !payload.data || !payload.data.rate) {
      throw new Error('Price fetch failed for ' + symbol);
    }
    return Number(payload.data.rate);
  }

  async function fetch24hChange(symbol) {
    try {
      var response = await fetch('/api/market/ohlcv/?base=' + encodeURIComponent(symbol) + '&quote=USDT&period_id=1DAY&limit=2');
      var payload = await response.json();
      if (!response.ok || !payload.ok || !Array.isArray(payload.rows) || payload.rows.length < 2) {
        return 0;
      }
      var first = Number(payload.rows[0].price_close);
      var last = Number(payload.rows[payload.rows.length - 1].price_close);
      if (!first) {
        return 0;
      }
      return ((last - first) / first) * 100;
    } catch (error) {
      return 0;
    }
  }

  async function fetchBtcSeries() {
    var response = await fetch('/api/market/ohlcv/?base=BTC&quote=USDT&period_id=1DAY&limit=30');
    var payload = await response.json();
    if (!response.ok || !payload.ok || !Array.isArray(payload.rows) || !payload.rows.length) {
      throw new Error('BTC series fetch failed');
    }
    return payload.rows.map(function (row) {
      return Number(row.price_close);
    });
  }

  function buildPath(values) {
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var xStep = 1000 / (values.length - 1);
    var range = max - min || 1;

    var points = values.map(function (v, i) {
      var x = i * xStep;
      var y = 170 - ((v - min) / range) * 120;
      return { x: x, y: y };
    });

    var d = 'M' + points[0].x + ',' + points[0].y;
    for (var i = 1; i < points.length; i += 1) {
      d += ' L' + points[i].x + ',' + points[i].y;
    }
    var fill = d + ' L1000,200 L0,200 Z';

    return { line: d, fill: fill };
  }

  function renderAssets(rows) {
    if (!assetBody) {
      return;
    }
    assetBody.innerHTML = rows.map(function (row) {
      var changeColor = row.change >= 0 ? 'var(--success)' : '#ff453a';
      return (
        '<tr>' +
          '<td><div class="asset-info">' +
            '<div class="asset-icon" style="color:' + row.color + '">' + row.symbol.charAt(0) + '</div>' +
            '<div><div>' + row.name + '</div><div style="font-size:11px; color: var(--text-secondary)">' + row.symbol + '</div></div>' +
          '</div></td>' +
          '<td>' + formatUsd(row.price) + '</td>' +
          '<td>' + formatUsd(row.value) + '</td>' +
          '<td style="color:' + changeColor + '">' + formatPct(row.change) + '</td>' +
          '<td style="text-align:right;"><a class="btn-trade" href="/dashboard/">Trade</a></td>' +
        '</tr>'
      );
    }).join('');
  }

  function setBalanceDisplay() {
    if (!balanceAmountEl || !toggleBtn) {
      return;
    }
    balanceAmountEl.textContent = isHidden ? '********' : currentBalanceText;
    toggleBtn.innerHTML = isHidden ? getHiddenIcon() : getVisibleIcon();
  }

  async function hydrateOverview() {
    nextPayoutEl.textContent = getNextPayoutText();

    try {
      var rows = await Promise.all(holdings.map(async function (holding) {
        var price = await fetchPrice(holding.symbol);
        var change = await fetch24hChange(holding.symbol);
        return {
          name: holding.name,
          symbol: holding.symbol,
          color: holding.color,
          price: price,
          value: holding.amount * price,
          change: change,
        };
      }));

      var total = rows.reduce(function (sum, item) { return sum + item.value; }, 0);
      var pnlValue = total * 0.042;
      var monthly = total * 0.087;
      var pnlPct = total ? (pnlValue / total) * 100 : 0;

      currentBalanceText = formatUsd(total);
      balancePnlEl.textContent = '+ ' + formatUsd(pnlValue) + ' (' + formatPct(pnlPct) + ')';
      monthlyProfitEl.textContent = formatUsd(monthly);
      setBalanceDisplay();
      renderAssets(rows);
    } catch (error) {
      currentBalanceText = '$142,502.84';
      if (balancePnlEl) {
        balancePnlEl.textContent = '+ +$5,240.12 (4.2%)';
      }
      if (monthlyProfitEl) {
        monthlyProfitEl.textContent = '$12,400.00';
      }
      setBalanceDisplay();
    }

    try {
      var series = await fetchBtcSeries();
      var path = buildPath(series);
      if (chartLineEl) {
        chartLineEl.setAttribute('d', path.line);
      }
      if (chartFillEl) {
        chartFillEl.setAttribute('d', path.fill);
      }
    } catch (error) {
      var fallbackPath = buildPath([80, 82, 79, 87, 84, 92, 96, 94, 99, 105]);
      if (chartLineEl) {
        chartLineEl.setAttribute('d', fallbackPath.line);
      }
      if (chartFillEl) {
        chartFillEl.setAttribute('d', fallbackPath.fill);
      }
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      isHidden = !isHidden;
      setBalanceDisplay();
    });
  }

  hydrateOverview();
});
