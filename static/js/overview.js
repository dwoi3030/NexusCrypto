document.addEventListener('DOMContentLoaded', function () {
  var PORTFOLIO_KEY = 'nexus_portfolio_v1';
  var DEFAULT_PORTFOLIO = {
    cashUsd: 50,
    todaysPnl: 50,
    holdings: {},
  };
  var ASSET_META = {
    BTC: { name: 'Bitcoin', color: '#F7931A' },
    ETH: { name: 'Ethereum', color: '#627EEA' },
    SOL: { name: 'Solana', color: '#14F195' },
    BNB: { name: 'Binance Coin', color: '#F3BA2F' },
    XRP: { name: 'XRP', color: '#23292F' },
    ADA: { name: 'Cardano', color: '#2A6CF0' },
    DOGE: { name: 'Dogecoin', color: '#C2A633' },
  };

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

  function readPortfolioState() {
    try {
      var raw = localStorage.getItem(PORTFOLIO_KEY);
      if (!raw) {
        return {
          cashUsd: DEFAULT_PORTFOLIO.cashUsd,
          todaysPnl: DEFAULT_PORTFOLIO.todaysPnl,
          holdings: {},
        };
      }
      var parsed = JSON.parse(raw);
      return {
        cashUsd: Number(parsed.cashUsd || DEFAULT_PORTFOLIO.cashUsd),
        todaysPnl: Number(parsed.todaysPnl || 0),
        holdings: parsed.holdings && typeof parsed.holdings === 'object' ? parsed.holdings : {},
      };
    } catch (error) {
      return {
        cashUsd: DEFAULT_PORTFOLIO.cashUsd,
        todaysPnl: DEFAULT_PORTFOLIO.todaysPnl,
        holdings: {},
      };
    }
  }

  function getHoldingsFromState(state) {
    var holdingsMap = state.holdings || {};
    return Object.keys(holdingsMap).map(function (symbol) {
      var amount = Number(holdingsMap[symbol] || 0);
      var upper = String(symbol || '').toUpperCase();
      var meta = ASSET_META[upper] || { name: upper, color: '#8e8e93' };
      return {
        name: meta.name,
        symbol: upper,
        amount: amount,
        color: meta.color,
      };
    }).filter(function (item) {
      return item.amount > 0;
    });
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

  async function fetchAssetSeries(symbol) {
    var response = await fetch('/api/market/ohlcv/?base=' + encodeURIComponent(symbol) + '&quote=USDT&period_id=1DAY&limit=30');
    var payload = await response.json();
    if (!response.ok || !payload.ok || !Array.isArray(payload.rows) || !payload.rows.length) {
      throw new Error('Series fetch failed for ' + symbol);
    }
    return payload.rows.map(function (row) {
      return Number(row.price_close);
    });
  }

  function buildPortfolioPnlSeries(seriesBySymbol) {
    var lengths = Object.keys(seriesBySymbol).map(function (symbol) {
      return (seriesBySymbol[symbol] || []).length;
    }).filter(function (len) {
      return len > 0;
    });
    if (!lengths.length) {
      return [];
    }

    var minLen = Math.min.apply(null, lengths);
    var totalSeries = [];
    for (var i = 0; i < minLen; i += 1) {
      var totalForPoint = 0;
      for (var h = 0; h < holdings.length; h += 1) {
        var holding = holdings[h];
        var points = seriesBySymbol[holding.symbol];
        var price = points ? Number(points[i] || 0) : 0;
        totalForPoint += holding.amount * price;
      }
      totalSeries.push(totalForPoint);
    }

    var baseValue = totalSeries[0] || 0;
    return totalSeries.map(function (portfolioValue) {
      return portfolioValue - baseValue;
    });
  }

  function buildPath(values) {
    if (!values.length) {
      values = [0, 0];
    }
    if (values.length === 1) {
      values = [values[0], values[0]];
    }
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
    if (!rows.length) {
      assetBody.innerHTML =
        '<tr class="asset-empty-row">' +
          '<td colspan="5" style="padding:18px 0; color: var(--text-secondary);">No assets yet. Buy from Trade to see them here.</td>' +
        '</tr>';
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
    var portfolioState = readPortfolioState();
    var holdings = getHoldingsFromState(portfolioState);

    if (!holdings.length) {
      currentBalanceText = formatUsd(portfolioState.cashUsd);
      if (balancePnlEl) {
        var cashPnlPct = portfolioState.cashUsd ? (portfolioState.todaysPnl / portfolioState.cashUsd) * 100 : 0;
        var pnlPrefix = portfolioState.todaysPnl >= 0 ? '+ ' : '- ';
        balancePnlEl.textContent = pnlPrefix + formatUsd(Math.abs(portfolioState.todaysPnl)) + ' (' + formatPct(cashPnlPct) + ')';
      }
      if (monthlyProfitEl) {
        monthlyProfitEl.textContent = formatUsd(portfolioState.todaysPnl);
      }
      setBalanceDisplay();
      renderAssets([]);
      var emptyPath = buildPath([0, 0, 0, 0, 0, 0]);
      if (chartLineEl) {
        chartLineEl.setAttribute('d', emptyPath.line);
      }
      if (chartFillEl) {
        chartFillEl.setAttribute('d', emptyPath.fill);
      }
      return;
    }

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

      var holdingsTotal = rows.reduce(function (sum, item) { return sum + item.value; }, 0);
      var total = portfolioState.cashUsd + holdingsTotal;
      var costBasisEstimate = portfolioState.cashUsd + rows.reduce(function (sum, item) {
        var entryPrice = item.price / (1 + (item.change / 100));
        return sum + ((entryPrice || item.price) * holdings.find(function (h) { return h.symbol === item.symbol; }).amount);
      }, 0);
      var marketPnl = total - costBasisEstimate;
      var pnlValue = portfolioState.todaysPnl + marketPnl;
      var pnlPct = total ? (pnlValue / total) * 100 : 0;
      var monthly = pnlValue;

      currentBalanceText = formatUsd(total);
      balancePnlEl.textContent = (pnlValue >= 0 ? '+ ' : '- ') + formatUsd(Math.abs(pnlValue)) + ' (' + formatPct(pnlPct) + ')';
      monthlyProfitEl.textContent = formatUsd(monthly);
      setBalanceDisplay();
      renderAssets(rows);
    } catch (error) {
      currentBalanceText = formatUsd(portfolioState.cashUsd);
      if (balancePnlEl) {
        balancePnlEl.textContent = '+ ' + formatUsd(Math.abs(portfolioState.todaysPnl));
      }
      if (monthlyProfitEl) {
        monthlyProfitEl.textContent = formatUsd(portfolioState.todaysPnl);
      }
      setBalanceDisplay();
      renderAssets([]);
    }

    try {
      var seriesResults = await Promise.all(holdings.map(async function (holding) {
        var series = await fetchAssetSeries(holding.symbol);
        return { symbol: holding.symbol, series: series };
      }));
      var seriesBySymbol = {};
      seriesResults.forEach(function (item) {
        seriesBySymbol[item.symbol] = item.series;
      });

      var portfolioPnlSeries = buildPortfolioPnlSeries(seriesBySymbol);
      var path = buildPath(portfolioPnlSeries.length ? portfolioPnlSeries : [0, 0, 0, 0, 0]);
      if (chartLineEl) {
        chartLineEl.setAttribute('d', path.line);
      }
      if (chartFillEl) {
        chartFillEl.setAttribute('d', path.fill);
      }
    } catch (error) {
      var fallbackPath = buildPath([0, 120, 40, 180, 130, 260, 220, 340, 280, 420]);
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
