document.addEventListener('DOMContentLoaded', function () {
  var profileTrigger = document.getElementById('profileTrigger');
  var profileMenu = document.getElementById('profileMenu');
  var tabs = document.querySelectorAll('.tab');
  var livePrice = document.getElementById('live-price');
  var liveChange = document.getElementById('live-change');
  var lastPrice = document.getElementById('last-price');
  var tradePrice = document.getElementById('trade-price');
  var tradeAmount = document.getElementById('trade-amount');
  var tradeRange = document.getElementById('trade-range');
  var buyBtn = document.getElementById('buy-btn');
  var sellBtn = document.getElementById('sell-btn');
  var tradeFeedback = document.getElementById('trade-feedback');
  var availableUsdtEl = document.getElementById('available-usdt');
  var priceChartEl = document.getElementById('priceChart');
  var searchInput = document.getElementById('asset-search-input');
  var searchDropdown = document.getElementById('asset-search-dropdown');
  var pairBase = document.getElementById('pair-base');
  var pairName = document.getElementById('pair-name');
  var pairLogo = document.getElementById('pair-logo');
  var miniEstimatedAssetsEl = document.getElementById('miniEstimatedAssets');
  var miniTodaysPnlEl = document.getElementById('miniTodaysPnl');

  var chart = null;
  var chartRows = [];
  var allAssets = [];
  var PORTFOLIO_KEY = 'nexus_portfolio_v1';
  var DEFAULT_PORTFOLIO = {
    cashUsd: 50,
    todaysPnl: 50,
    holdings: {},
  };
  var selectedAsset = {
    symbol: 'BTC',
    name: 'Bitcoin',
    image: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
  };

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

  function writePortfolioState(state) {
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify({
      cashUsd: Number(state.cashUsd || 0),
      todaysPnl: Number(state.todaysPnl || 0),
      holdings: state.holdings || {},
    }));
  }

  var portfolioState = readPortfolioState();
  var wallet = {
    usdt: portfolioState.cashUsd,
    holdings: portfolioState.holdings || {},
    latestPrice: 64321,
  };
  var priceBySymbol = {};

  var crosshairPlugin = {
    id: 'crosshairPlugin',
    afterDatasetsDraw: function (chartInstance) {
      var tooltip = chartInstance.tooltip;
      if (!tooltip || !tooltip.getActiveElements || !tooltip.getActiveElements().length) {
        return;
      }

      var activePoint = tooltip.getActiveElements()[0];
      var x = activePoint.element.x;
      var y = activePoint.element.y;
      var ctx = chartInstance.ctx;
      var chartArea = chartInstance.chartArea;

      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(255, 95, 95, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#ff5f5f';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,95,95,0.35)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },
  };

  if (typeof Chart !== 'undefined' && Chart.registry && !Chart.registry.plugins.get('crosshairPlugin')) {
    Chart.register(crosshairPlugin);
  }

  if (profileTrigger && profileMenu) {
    profileTrigger.addEventListener('click', function (event) {
      event.stopPropagation();
      profileMenu.classList.toggle('show');
    });

    document.addEventListener('click', function (event) {
      if (!profileMenu.contains(event.target) && !profileTrigger.contains(event.target)) {
        profileMenu.classList.remove('show');
      }
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (item) {
        item.classList.remove('active');
      });
      tab.classList.add('active');
    });
  });

  function formatUsd(value) {
    return Number(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatVolume(value) {
    return Math.round(Number(value || 0)).toLocaleString('en-US');
  }

  function setFeedback(message, kind) {
    if (!tradeFeedback) {
      return;
    }
    tradeFeedback.textContent = message;
    if (kind === 'success') {
      tradeFeedback.style.color = '#32d74b';
      return;
    }
    if (kind === 'error') {
      tradeFeedback.style.color = '#ff453a';
      return;
    }
    tradeFeedback.style.color = '#848e9c';
  }

  function updateAvailable() {
    if (availableUsdtEl) {
      availableUsdtEl.textContent = formatUsd(wallet.usdt) + ' USDT';
    }
  }

  function persistPortfolioState() {
    portfolioState.cashUsd = wallet.usdt;
    portfolioState.holdings = wallet.holdings;
    writePortfolioState(portfolioState);
  }

  function updateMiniPortfolio() {
    if (!miniEstimatedAssetsEl || !miniTodaysPnlEl) {
      return;
    }
    var estimatedAssets = wallet.usdt;
    Object.keys(wallet.holdings || {}).forEach(function (symbol) {
      var amount = Number(wallet.holdings[symbol] || 0);
      if (amount <= 0) {
        return;
      }
      var knownPrice = Number(priceBySymbol[symbol] || 0);
      estimatedAssets += amount * knownPrice;
    });

    var pnl = Number(portfolioState.todaysPnl || 0);
    miniEstimatedAssetsEl.textContent = '$' + formatUsd(estimatedAssets);
    miniTodaysPnlEl.textContent = "Today's PNL: " + (pnl >= 0 ? '+$' : '-$') + formatUsd(Math.abs(pnl));
  }

  function setLivePrice(price) {
    wallet.latestPrice = Number(price);
    priceBySymbol[selectedAsset.symbol] = Number(price);
    var text = '$' + formatUsd(price);
    if (livePrice) {
      livePrice.textContent = text;
    }
    if (lastPrice) {
      lastPrice.textContent = text;
    }
    if (tradePrice) {
      tradePrice.value = Number(price).toFixed(2);
    }
    updateMiniPortfolio();
  }

  function setLiveChange(changePct) {
    if (!liveChange) {
      return;
    }
    var positive = changePct >= 0;
    liveChange.textContent = (positive ? '+' : '') + changePct.toFixed(2) + '%';
    liveChange.classList.remove('positive', 'negative');
    liveChange.classList.add(positive ? 'positive' : 'negative');
  }

  function buildInlineLogo(symbol) {
    var text = String(symbol || '?').slice(0, 3).toUpperCase();
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#9b51e0"/><stop offset="100%" stop-color="#e91e63"/>' +
      '</linearGradient></defs>' +
      '<rect width="64" height="64" rx="32" fill="url(#g)"/>' +
      '<text x="50%" y="54%" text-anchor="middle" fill="#ffffff" font-size="22" font-family="Arial, sans-serif" font-weight="700">' + text + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function getSymbolLogoUrl(symbol) {
    var key = String(symbol || '').toUpperCase();
    var bySymbol = {
      BTC: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
      ETH: 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
      BNB: 'https://cryptologos.cc/logos/bnb-bnb-logo.png',
      SOL: 'https://cryptologos.cc/logos/solana-sol-logo.png',
      XRP: 'https://cryptologos.cc/logos/xrp-xrp-logo.png',
      ADA: 'https://cryptologos.cc/logos/cardano-ada-logo.png',
      DOGE: 'https://cryptologos.cc/logos/dogecoin-doge-logo.png',
      USDT: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
      USDC: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
      TRX: 'https://cryptologos.cc/logos/tron-trx-logo.png',
      DOT: 'https://cryptologos.cc/logos/polkadot-new-dot-logo.png',
      AVAX: 'https://cryptologos.cc/logos/avalanche-avax-logo.png',
      LTC: 'https://cryptologos.cc/logos/litecoin-ltc-logo.png',
      LINK: 'https://cryptologos.cc/logos/chainlink-link-logo.png',
      MATIC: 'https://cryptologos.cc/logos/polygon-matic-logo.png',
    };
    return bySymbol[key] || '';
  }

  function setPair(asset) {
    selectedAsset = asset;
    if (pairBase) {
      pairBase.textContent = asset.symbol;
    }
    if (pairName) {
      pairName.textContent = asset.name;
    }
    if (pairLogo) {
      var symbolLogo = getSymbolLogoUrl(asset.symbol);
      var fallback = buildInlineLogo(asset.symbol);
      pairLogo.onerror = function () {
        if (pairLogo.src !== symbolLogo && symbolLogo) {
          pairLogo.src = symbolLogo;
          return;
        }
        pairLogo.onerror = null;
        pairLogo.src = fallback;
      };
      pairLogo.src = asset.image || symbolLogo || fallback;
      pairLogo.alt = asset.name || asset.symbol;
    }
    if (buyBtn) {
      buyBtn.textContent = 'Buy ' + selectedAsset.symbol;
    }
    if (sellBtn) {
      sellBtn.textContent = 'Sell ' + selectedAsset.symbol;
    }
    if (tradeAmount) {
      var unitEl = tradeAmount.parentElement && tradeAmount.parentElement.querySelector('span');
      if (unitEl) {
        unitEl.textContent = selectedAsset.symbol;
      }
    }
    updateMiniPortfolio();
  }

  function getTooltipEl(chartInstance) {
    var parent = chartInstance.canvas.parentNode;
    var el = parent.querySelector('.chart-position-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.className = 'chart-position-tooltip';
      parent.appendChild(el);
    }
    return el;
  }

  function externalTooltipHandler(context) {
    var chartInstance = context.chart;
    var tooltipModel = context.tooltip;
    var tooltipEl = getTooltipEl(chartInstance);

    if (tooltipModel.opacity === 0) {
      tooltipEl.style.opacity = 0;
      return;
    }

    var dataPoint = tooltipModel.dataPoints && tooltipModel.dataPoints[0];
    if (!dataPoint) {
      tooltipEl.style.opacity = 0;
      return;
    }

    var row = chartRows[dataPoint.dataIndex] || {};
    var dt = row.time ? new Date(row.time) : null;
    var timeText = dt ? dt.toLocaleString() : '--';
    var priceText = '$' + formatUsd(row.price || dataPoint.parsed.y);
    var volumeText = '$' + formatVolume(row.volume || 0);

    tooltipEl.innerHTML =
      '<div class="tooltip-time">' + timeText + '</div>' +
      '<div class="tooltip-line">Price: <b>' + priceText + '</b></div>' +
      '<div class="tooltip-line">Vol: <b>' + volumeText + '</b></div>';

    var left = tooltipModel.caretX + 14;
    var top = tooltipModel.caretY - 40;

    if (left + tooltipEl.offsetWidth > chartInstance.width) {
      left = tooltipModel.caretX - tooltipEl.offsetWidth - 14;
    }
    if (top < 8) {
      top = 8;
    }

    tooltipEl.style.opacity = 1;
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
  }

  function buildChart(labels, values) {
    if (typeof Chart === 'undefined' || !priceChartEl) {
      return;
    }

    var ctx = priceChartEl.getContext('2d');
    var gradient = ctx.createLinearGradient(0, 0, 0, 360);
    gradient.addColorStop(0, 'rgba(255,95,95,0.30)');
    gradient.addColorStop(1, 'rgba(255,95,95,0.02)');

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = values;
      chart.update('none');
      return;
    }

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          borderColor: '#ff3b30',
          backgroundColor: gradient,
          fill: true,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: '#ff3b30',
          tension: 0.25,
        }],
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: externalTooltipHandler,
          },
        },
        scales: {
          x: {
            ticks: { color: '#848e9c', maxTicksLimit: 8 },
            grid: { color: 'rgba(255,255,255,0.03)' },
          },
          y: {
            ticks: {
              color: '#848e9c',
              callback: function (value) {
                return formatUsd(value);
              },
            },
            grid: { color: 'rgba(255,255,255,0.03)' },
          },
        },
      },
    });
  }

  function buildFallbackSeries(basePrice) {
    var seed = Number(basePrice || wallet.latestPrice || 0);
    if (!seed || Number.isNaN(seed)) {
      seed = 100;
    }
    var points = [];
    for (var i = 0; i < 30; i += 1) {
      var drift = Math.sin(i / 3) * 0.004 + Math.cos(i / 5) * 0.002;
      points.push(seed * (1 + drift));
    }
    return points;
  }

  async function fetchTopAssets() {
    var response = await fetch('/api/market/top-assets/');
    var payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'top assets fetch failed');
    }
    return payload.assets || [];
  }

  async function fetchPrice(base) {
    var response = await fetch('/api/market/price/?base=' + encodeURIComponent(base) + '&quote=USD');
    var payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'price fetch failed');
    }
    return Number(payload.data.rate);
  }

  async function fetchOhlcv(base) {
    var response = await fetch('/api/market/ohlcv/?base=' + encodeURIComponent(base) + '&quote=USDT&period_id=1MIN&limit=90');
    var payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'ohlcv fetch failed');
    }
    return payload.rows || [];
  }

  function renderAssetOptions(assets) {
    if (!searchDropdown) {
      return;
    }
    if (!assets.length) {
      searchDropdown.innerHTML = '';
      searchDropdown.classList.remove('show');
      return;
    }

    searchDropdown.innerHTML = assets.map(function (asset) {
      return (
        '<div class="asset-option" data-symbol="' + asset.symbol + '" data-name="' + asset.name + '" data-image="' + (asset.image || '') + '">' +
          '<span class="asset-symbol">' + asset.symbol + '</span>' +
          '<span class="asset-name">' + asset.name + '</span>' +
        '</div>'
      );
    }).join('');
    searchDropdown.classList.add('show');

    searchDropdown.querySelectorAll('.asset-option').forEach(function (el) {
      el.addEventListener('click', function () {
        var asset = {
          symbol: el.getAttribute('data-symbol') || 'BTC',
          name: el.getAttribute('data-name') || 'Bitcoin',
          image: el.getAttribute('data-image') || '',
        };
        setPair(asset);
        if (searchInput) {
          searchInput.value = asset.symbol + ' - ' + asset.name;
        }
        searchDropdown.classList.remove('show');
        refreshMarket(asset.symbol);
      });
    });
  }

  function filterAssets(term) {
    var q = (term || '').trim().toLowerCase();
    if (!q) {
      renderAssetOptions(allAssets.slice(0, 20));
      return;
    }
    var filtered = allAssets.filter(function (asset) {
      return asset.symbol.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q);
    }).slice(0, 25);
    renderAssetOptions(filtered);
  }

  async function refreshMarket(baseSymbol) {
    var base = (baseSymbol || selectedAsset.symbol || 'BTC').toUpperCase();
    try {
      var rows = await fetchOhlcv(base);
      if (!rows.length) {
        throw new Error('No OHLCV rows');
      }

      chartRows = rows.map(function (item) {
        return {
          time: item.time_period_start,
          price: Number(item.price_close),
          volume: Number(item.volume_traded || 0),
        };
      });

      var labels = chartRows.map(function (item) {
        var dt = new Date(item.time);
        var hh = String(dt.getHours()).padStart(2, '0');
        var mm = String(dt.getMinutes()).padStart(2, '0');
        return hh + ':' + mm;
      });
      var closes = chartRows.map(function (item) { return item.price; });

      var first = closes[0];
      var latest = closes[closes.length - 1];
      var changePct = first ? ((latest - first) / first) * 100 : 0;

      setLivePrice(latest);
      setLiveChange(changePct);
      buildChart(labels, closes);
      setFeedback('Market data live for ' + base + '.', 'success');
    } catch (err) {
      var fallback = buildFallbackSeries(wallet.latestPrice);
      var labels = fallback.map(function (_, i) { return String(i + 1); });
      buildChart(labels, fallback);
      if (fallback.length) {
        setLivePrice(fallback[fallback.length - 1]);
        setLiveChange(0);
      }
      setFeedback('Live chart unavailable for ' + base + '.', 'error');
      console.error(err);
    }
  }

  async function refreshTopPriceOnly() {
    try {
      var rate = await fetchPrice(selectedAsset.symbol);
      setLivePrice(rate);
    } catch (err) {
      console.error(err);
    }
  }

  function onRangeChange() {
    var pct = Number(tradeRange.value || 0) / 100;
    var amount = (wallet.usdt * pct) / wallet.latestPrice;
    tradeAmount.value = amount > 0 ? amount.toFixed(6) : '';
  }

  function buyNow() {
    var amount = Number(tradeAmount.value || 0);
    if (!amount || amount <= 0) {
      setFeedback('Enter a valid buy amount.', 'error');
      return;
    }
    var cost = amount * wallet.latestPrice;
    if (cost > wallet.usdt) {
      setFeedback('Not enough USDT for this buy.', 'error');
      return;
    }
    wallet.usdt -= cost;
    var symbol = selectedAsset.symbol;
    wallet.holdings[symbol] = Number(wallet.holdings[symbol] || 0) + amount;
    updateAvailable();
    persistPortfolioState();
    updateMiniPortfolio();
    tradeRange.value = '0';
    tradeAmount.value = '';
    setFeedback('Buy order executed (simulation).', 'success');
  }

  function sellNow() {
    var amount = Number(tradeAmount.value || 0);
    if (!amount || amount <= 0) {
      setFeedback('Enter a valid sell amount.', 'error');
      return;
    }
    var symbol = selectedAsset.symbol;
    var position = Number(wallet.holdings[symbol] || 0);
    if (amount > position) {
      setFeedback('Not enough ' + symbol + ' for this sell.', 'error');
      return;
    }
    var revenue = amount * wallet.latestPrice;
    wallet.holdings[symbol] = position - amount;
    if (wallet.holdings[symbol] <= 0) {
      delete wallet.holdings[symbol];
    }
    wallet.usdt += revenue;
    updateAvailable();
    persistPortfolioState();
    updateMiniPortfolio();
    tradeRange.value = '0';
    tradeAmount.value = '';
    setFeedback('Sell order executed (simulation).', 'success');
  }

  if (searchInput && searchDropdown) {
    searchInput.addEventListener('focus', function () {
      filterAssets(searchInput.value);
    });

    searchInput.addEventListener('input', function () {
      filterAssets(searchInput.value);
    });

    document.addEventListener('click', function (event) {
      if (!searchDropdown.contains(event.target) && event.target !== searchInput) {
        searchDropdown.classList.remove('show');
      }
    });
  }

  if (tradeRange) {
    tradeRange.addEventListener('input', onRangeChange);
  }
  if (buyBtn) {
    buyBtn.addEventListener('click', buyNow);
  }
  if (sellBtn) {
    sellBtn.addEventListener('click', sellNow);
  }

  updateAvailable();
  persistPortfolioState();
  updateMiniPortfolio();
  setPair(selectedAsset);

  fetchTopAssets()
    .then(function (assets) {
      allAssets = assets;
      if (searchInput) {
        searchInput.value = selectedAsset.symbol + ' - ' + selectedAsset.name;
      }
    })
    .catch(function (err) {
      console.error(err);
      setFeedback('Top-100 list unavailable right now.', 'error');
    });

  refreshMarket(selectedAsset.symbol);
  setInterval(function () {
    refreshMarket(selectedAsset.symbol);
  }, 60000);
  setInterval(refreshTopPriceOnly, 10000);
});
