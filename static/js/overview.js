document.addEventListener('DOMContentLoaded', function () {
  var Sync = window.NexusPortfolioSync || null;
  var PORTFOLIO_KEY = 'nexus_portfolio_v1';
  var DAILY_BASELINE_KEY = 'nexus_overview_daily_baseline_v1_' + ((Sync && Sync.USER_SCOPE) ? Sync.USER_SCOPE : 'anonymous');
  var serverWalletUsd = Number(window.__NEXUS_WALLET_USD__);
  var hasServerWalletUsd = Number.isFinite(serverWalletUsd) && serverWalletUsd >= 0;
  var DEFAULT_PORTFOLIO = {
    cashUsd: hasServerWalletUsd ? serverWalletUsd : 50,
    todaysPnl: 0,
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

  var FAST_REFRESH_MS = 4000;
  var SLOW_REFRESH_MS = 60000;
  var isFastRefreshing = false;
  var isChartRefreshing = false;

  var livePriceMap = {};
  var liveChangeMap = {};
  var stablePriceMap = {};
  var stableChangeMap = {};
  var liveSocket = null;
  var liveSocketKey = '';
  var liveRenderTimer = null;
  var LIVE_RENDER_MIN_MS = 180;

  var lastPortfolioState = null;
  var lastHoldings = [];
  var lastTotalValue = 0;
  var assetRowMap = {};

  var assetBody = document.getElementById('assetBody');
  var balanceAmountEl = document.getElementById('balanceAmount');
  var balancePnlEl = document.getElementById('balancePnl');
  var monthlyProfitEl = document.getElementById('monthlyProfit');
  var dailyProfitEl = document.getElementById('dailyProfit');
  var dailyProfitPctEl = document.getElementById('dailyProfitPct');
  var nextPayoutEl = document.getElementById('nextPayout');
  var toggleBtn = document.getElementById('toggleBalance');
  var chartLineEl = document.getElementById('overviewChartLine');
  var chartFillEl = document.getElementById('overviewChartFill');
  var chartGradientStartEl = document.getElementById('chartGradientStart');
  var chartGradientEndEl = document.getElementById('chartGradientEnd');

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

  function formatUsdOrDash(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '--';
    }
    return formatUsd(value);
  }

  function getStablePrice(symbol) {
    var price = Number(stablePriceMap[symbol]);
    if (Number.isFinite(price) && price > 0) {
      return price;
    }
    return null;
  }

  function updateStableTicker(symbol, rawPrice, rawChange) {
    var price = Number(rawPrice);
    var change = Number(rawChange);
    if (Number.isFinite(price) && price > 0) {
      livePriceMap[symbol] = price;
      stablePriceMap[symbol] = price;
    }
    if (Number.isFinite(change)) {
      liveChangeMap[symbol] = change;
      stableChangeMap[symbol] = change;
    }
  }

  function estimateMonthlyProfit(totalValue, dailyPnl) {
    var total = Number(totalValue || 0);
    var daily = Number(dailyPnl || 0);
    var projected = daily * 30;
    if (total <= 0) {
      return projected;
    }
    var maxAbs = total * 0.4;
    if (projected > maxAbs) {
      return maxAbs;
    }
    if (projected < -maxAbs) {
      return -maxAbs;
    }
    return projected;
  }

  function getTodayKey() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  function readDailyBaseline() {
    try {
      var raw = localStorage.getItem(DAILY_BASELINE_KEY);
      if (!raw) {
        return null;
      }
      var data = JSON.parse(raw);
      if (!data || !data.day || !Number.isFinite(Number(data.baselineTotal))) {
        return null;
      }
      return {
        day: String(data.day),
        baselineTotal: Number(data.baselineTotal),
      };
    } catch (error) {
      return null;
    }
  }

  function writeDailyBaseline(day, baselineTotal) {
    localStorage.setItem(DAILY_BASELINE_KEY, JSON.stringify({
      day: day,
      baselineTotal: Number(baselineTotal || 0),
    }));
  }

  function computeDailyMetrics(currentTotal) {
    var total = Number(currentTotal || 0);
    var todayKey = getTodayKey();
    var baseline = readDailyBaseline();
    if (!baseline || baseline.day !== todayKey) {
      writeDailyBaseline(todayKey, total);
      baseline = { day: todayKey, baselineTotal: total };
    }
    var dailyPnl = total - Number(baseline.baselineTotal || 0);
    var dailyPct = baseline.baselineTotal ? (dailyPnl / baseline.baselineTotal) * 100 : 0;
    return { dailyPnl: dailyPnl, dailyPct: dailyPct };
  }

  function readPortfolioState() {
    if (Sync) {
      return Sync.readPortfolio();
    }
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
        cashUsd: hasServerWalletUsd ? serverWalletUsd : Number(parsed.cashUsd || DEFAULT_PORTFOLIO.cashUsd),
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
    }).sort(function (a, b) {
      return a.symbol.localeCompare(b.symbol);
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

  function setBalanceDisplay() {
    if (!balanceAmountEl || !toggleBtn) {
      return;
    }
    balanceAmountEl.textContent = isHidden ? '********' : currentBalanceText;
    toggleBtn.innerHTML = isHidden ? getHiddenIcon() : getVisibleIcon();
  }

  function setPnlDisplay(value, pct) {
    if (!balancePnlEl) {
      return;
    }
    var numericValue = Number(value || 0);
    var isProfit = numericValue >= 0;
    var prefix = isProfit ? '+ ' : '- ';
    var pctText = typeof pct === 'number' ? ' (' + formatPct(pct) + ')' : '';
    balancePnlEl.textContent = prefix + formatUsd(Math.abs(numericValue)) + pctText;
    balancePnlEl.style.color = isProfit ? 'var(--success)' : 'var(--danger)';
  }

  function setDailyProfitDisplay(value, pct) {
    if (!dailyProfitEl || !dailyProfitPctEl) {
      return;
    }
    var numericValue = Number(value || 0);
    var isProfit = numericValue >= 0;
    var prefix = isProfit ? '+ ' : '- ';
    dailyProfitEl.textContent = prefix + formatUsd(Math.abs(numericValue));
    dailyProfitEl.style.color = isProfit ? 'var(--success)' : 'var(--danger)';
    dailyProfitPctEl.textContent = (isProfit ? '+' : '') + Number(pct || 0).toFixed(2) + '%';
    dailyProfitPctEl.style.color = isProfit ? 'var(--success)' : 'var(--danger)';
  }

  function pulseBalance(total) {
    if (!lastTotalValue) {
      lastTotalValue = total;
      return;
    }
    lastTotalValue = total;
  }

  function rebuildAssetRows(rows) {
    assetRowMap = {};
    assetBody.innerHTML = rows.map(function (row) {
      var changeColor = row.change >= 0 ? 'var(--success)' : '#ff453a';
      return (
        '<tr data-symbol="' + row.symbol + '">' +
          '<td><div class="asset-info">' +
            '<div class="asset-icon" style="color:' + row.color + '">' + row.symbol.charAt(0) + '</div>' +
            '<div><div>' + row.name + '</div><div style="font-size:11px; color: var(--text-secondary)">' + row.symbol + '</div></div>' +
          '</div></td>' +
          '<td class="asset-price">' + formatUsdOrDash(row.price) + '</td>' +
          '<td class="asset-value">' + formatUsdOrDash(row.value) + '</td>' +
          '<td class="asset-change" style="color:' + changeColor + '">' + formatPct(row.change) + '</td>' +
          '<td style="text-align:right;"><a class="btn-trade" href="/dashboard/">Trade</a></td>' +
        '</tr>'
      );
    }).join('');

    rows.forEach(function (row) {
      var tr = assetBody.querySelector('tr[data-symbol="' + row.symbol + '"]');
      if (!tr) {
        return;
      }
      assetRowMap[row.symbol] = {
        priceEl: tr.querySelector('.asset-price'),
        valueEl: tr.querySelector('.asset-value'),
        changeEl: tr.querySelector('.asset-change'),
      };
    });
  }

  function updateAssetRows(rows) {
    rows.forEach(function (row) {
      var refs = assetRowMap[row.symbol];
      if (!refs) {
        return;
      }
      var nextPriceText = formatUsdOrDash(row.price);
      var nextValueText = formatUsdOrDash(row.value);
      var nextChangeText = formatPct(row.change);
      if (refs.priceEl) {
        if (refs.priceEl.textContent !== nextPriceText) {
          refs.priceEl.textContent = nextPriceText;
        }
      }
      if (refs.valueEl) {
        if (refs.valueEl.textContent !== nextValueText) {
          refs.valueEl.textContent = nextValueText;
        }
      }
      if (refs.changeEl) {
        if (refs.changeEl.textContent !== nextChangeText) {
          refs.changeEl.textContent = nextChangeText;
        }
        var nextColor = row.change >= 0 ? 'var(--success)' : '#ff453a';
        if (refs.changeEl.style.color !== nextColor) {
          refs.changeEl.style.color = nextColor;
        }
      }
    });
  }

  function renderAssets(rows) {
    if (!assetBody) {
      return;
    }
    if (!rows.length) {
      assetRowMap = {};
      assetBody.innerHTML =
        '<tr class="asset-empty-row">' +
          '<td colspan="5" style="padding:18px 0; color: var(--text-secondary);">No assets yet. Buy from Trade to see them here.</td>' +
        '</tr>';
      return;
    }
    var nextSymbols = rows.map(function (row) { return row.symbol; }).slice().sort().join('|');
    var currentSymbols = Object.keys(assetRowMap).slice().sort().join('|');
    if (nextSymbols !== currentSymbols || !Object.keys(assetRowMap).length) {
      rebuildAssetRows(rows);
      return;
    }
    updateAssetRows(rows);
  }

  function scheduleLiveRender() {
    if (liveRenderTimer) {
      return;
    }
    liveRenderTimer = setTimeout(function () {
      liveRenderTimer = null;
      renderPortfolioFromLive();
    }, LIVE_RENDER_MIN_MS);
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

  function buildPortfolioPnlSeries(seriesBySymbol, holdings, cashUsd) {
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
      var totalForPoint = Number(cashUsd || 0);
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

  function renderChartFromSeries(values) {
    var normalized = Array.isArray(values) && values.length ? values : [0, 0, 0, 0, 0];
    var path = buildPath(normalized);
    var latestValue = Number(normalized[normalized.length - 1] || 0);
    var isProfit = latestValue >= 0;
    var lineColor = isProfit ? 'var(--success)' : 'var(--danger)';
    var fillColor = isProfit ? 'rgba(50, 215, 75, 0.35)' : 'rgba(255, 69, 58, 0.35)';

    if (chartLineEl) {
      chartLineEl.setAttribute('d', path.line);
      chartLineEl.style.stroke = lineColor;
      chartLineEl.style.filter = 'drop-shadow(0 0 8px ' + fillColor + ')';
    }
    if (chartFillEl) {
      chartFillEl.setAttribute('d', path.fill);
    }
    if (chartGradientStartEl) {
      chartGradientStartEl.setAttribute('stop-color', fillColor);
    }
    if (chartGradientEndEl) {
      chartGradientEndEl.setAttribute('stop-color', 'transparent');
    }
  }

  function computeRows(portfolioState, holdings) {
    return holdings.map(function (holding) {
      var symbol = holding.symbol;
      var price = getStablePrice(symbol);
      if (price === null) {
        return {
          name: holding.name,
          symbol: symbol,
          color: holding.color,
          price: null,
          value: null,
          change: Number.isFinite(Number(stableChangeMap[symbol])) ? Number(stableChangeMap[symbol]) : 0,
          amount: holding.amount,
        };
      }
      return {
        name: holding.name,
        symbol: symbol,
        color: holding.color,
        price: price,
        value: holding.amount * price,
        change: Number.isFinite(Number(stableChangeMap[symbol])) ? Number(stableChangeMap[symbol]) : 0,
        amount: holding.amount,
      };
    });
  }

  function renderPortfolioFromLive() {
    if (!lastPortfolioState) {
      return;
    }
    var rows = computeRows(lastPortfolioState, lastHoldings);
    var total = Number(lastPortfolioState.cashUsd || 0) + rows.reduce(function (sum, item) { return sum + Number(item.value || 0); }, 0);
    var dailyMetrics = computeDailyMetrics(total);
    if (!rows.length) {
      currentBalanceText = formatUsd(lastPortfolioState.cashUsd);
      setPnlDisplay(dailyMetrics.dailyPnl, dailyMetrics.dailyPct);
      setDailyProfitDisplay(dailyMetrics.dailyPnl, dailyMetrics.dailyPct);
      if (monthlyProfitEl) {
        monthlyProfitEl.textContent = formatUsd(estimateMonthlyProfit(total, dailyMetrics.dailyPnl));
      }
      setBalanceDisplay();
      renderAssets([]);
      return;
    }

    currentBalanceText = formatUsd(total);
    pulseBalance(total);
    setPnlDisplay(dailyMetrics.dailyPnl, dailyMetrics.dailyPct);
    setDailyProfitDisplay(dailyMetrics.dailyPnl, dailyMetrics.dailyPct);
    if (monthlyProfitEl) {
      monthlyProfitEl.textContent = formatUsd(estimateMonthlyProfit(total, dailyMetrics.dailyPnl));
    }
    setBalanceDisplay();
    renderAssets(rows);
  }

  async function fetchSymbolsSnapshot(symbols) {
    if (!symbols.length) {
      return;
    }
    var query = encodeURIComponent(JSON.stringify(symbols.map(function (s) { return s + 'USDT'; })));
    var url = 'https://api.binance.com/api/v3/ticker/24hr?symbols=' + query;
    var response = await fetch(url);
    var payload = await response.json();
    if (!response.ok || !Array.isArray(payload)) {
      throw new Error('Failed to load symbol snapshot');
    }
    payload.forEach(function (item) {
      var symbol = String(item.symbol || '').replace('USDT', '');
      if (!symbol) {
        return;
      }
      updateStableTicker(symbol, item.lastPrice, item.priceChangePercent);
    });
  }

  function connectLiveStream(symbols) {
    if (!symbols.length) {
      if (liveSocket) {
        liveSocket.onclose = null;
        liveSocket.close();
        liveSocket = null;
      }
      liveSocketKey = '';
      return;
    }

    var key = symbols.slice().sort().join('|');
    if (key === liveSocketKey && liveSocket) {
      return;
    }
    liveSocketKey = key;

    if (liveSocket) {
      liveSocket.onclose = null;
      liveSocket.close();
      liveSocket = null;
    }

    var streams = symbols.map(function (s) { return s.toLowerCase() + 'usdt@miniTicker'; }).join('/');
    try {
      liveSocket = new WebSocket('wss://stream.binance.com:9443/stream?streams=' + streams);
      liveSocket.onmessage = function (event) {
        try {
          var payload = JSON.parse(event.data || '{}');
          var data = payload && payload.data ? payload.data : {};
          var symbol = String(data.s || '').replace('USDT', '');
          if (!symbol) {
            return;
          }
          updateStableTicker(symbol, data.c, data.P);
          scheduleLiveRender();
        } catch (error) {
          // ignore malformed tick
        }
      };
      liveSocket.onerror = function () {
        if (liveSocket) {
          liveSocket.close();
        }
      };
      liveSocket.onclose = function () {
        setTimeout(function () {
          connectLiveStream(symbols);
        }, 2500);
      };
    } catch (error) {
      liveSocket = null;
    }
  }

  async function refreshFast() {
    if (isFastRefreshing) {
      return;
    }
    isFastRefreshing = true;
    try {
      if (nextPayoutEl) {
        nextPayoutEl.textContent = getNextPayoutText();
      }

      var portfolioState = readPortfolioState();
      var holdings = getHoldingsFromState(portfolioState);
      lastPortfolioState = portfolioState;
      lastHoldings = holdings;

      if (!holdings.length) {
        connectLiveStream([]);
        renderPortfolioFromLive();
        renderChartFromSeries([0, portfolioState.todaysPnl]);
        return;
      }

      var symbols = holdings.map(function (h) { return h.symbol; });
      connectLiveStream(symbols);
      await fetchSymbolsSnapshot(symbols);
      renderPortfolioFromLive();
    } finally {
      isFastRefreshing = false;
    }
  }

  async function refreshChart() {
    if (isChartRefreshing || !lastPortfolioState) {
      return;
    }
    isChartRefreshing = true;
    try {
      var holdings = lastHoldings || [];
      if (!holdings.length) {
        renderChartFromSeries([0, Number(lastPortfolioState.todaysPnl || 0)]);
        return;
      }
      var seriesResults = await Promise.all(holdings.map(async function (holding) {
        var series = await fetchAssetSeries(holding.symbol);
        return { symbol: holding.symbol, series: series };
      }));
      var seriesBySymbol = {};
      seriesResults.forEach(function (item) {
        seriesBySymbol[item.symbol] = item.series;
      });
      var portfolioPnlSeries = buildPortfolioPnlSeries(seriesBySymbol, holdings, Number(lastPortfolioState.cashUsd || 0));
      renderChartFromSeries(portfolioPnlSeries);
    } catch (error) {
      renderChartFromSeries([0, Number(lastPortfolioState.todaysPnl || 0)]);
    } finally {
      isChartRefreshing = false;
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      isHidden = !isHidden;
      setBalanceDisplay();
    });
  }

  refreshFast().then(refreshChart);

  if (Sync) {
    Sync.onPortfolioChange(function () {
      refreshFast().then(refreshChart);
    }, { immediate: false });
  } else {
    window.addEventListener('storage', function (event) {
      if (event.key === PORTFOLIO_KEY) {
        refreshFast().then(refreshChart);
      }
    });
  }

  setInterval(refreshFast, FAST_REFRESH_MS);
  setInterval(refreshChart, SLOW_REFRESH_MS);
});
