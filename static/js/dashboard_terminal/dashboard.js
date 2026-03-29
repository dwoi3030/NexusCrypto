document.addEventListener('DOMContentLoaded', function () {
  var Sync = window.NexusPortfolioSync || null;
  var profileTrigger = document.getElementById('profileTrigger');
  var profileMenu = document.getElementById('profileMenu');
  var modeTabs = document.querySelectorAll('.trade-tabs .tab');
  var orderTypeTabs = document.querySelectorAll('.order-type-tab');
  var timeframeButtons = document.querySelectorAll('.tf-btn');
  var pctButtons = document.querySelectorAll('.pct-btn');
  var livePriceEl = document.getElementById('current-price') || document.getElementById('live-price');
  var liveChangeEl = document.getElementById('live-change');
  var lastPriceEl = document.getElementById('last-price');
  var tradePriceEl = document.getElementById('trade-price');
  var tradeAmountEl = document.getElementById('trade-amount');
  var availableUsdtEl = document.getElementById('available-usdt');
  var buyBtn = document.getElementById('buy-btn');
  var sellBtn = document.getElementById('sell-btn');
  var tradeFeedback = document.getElementById('trade-feedback');
  var feeEl = document.getElementById('calc-fee');
  var totalEl = document.getElementById('calc-total');
  var asksListEl = document.getElementById('asks-list');
  var bidsListEl = document.getElementById('bids-list');
  var statChangeEl = document.getElementById('stat-change');
  var statHighEl = document.getElementById('stat-high');
  var statLowEl = document.getElementById('stat-low');
  var statVolBtcEl = document.getElementById('stat-vol-btc');
  var statVolUsdtEl = document.getElementById('stat-vol-usdt');
  var tickerMarquee = document.getElementById('ticker-marquee');
  var tickerMarqueeClone = document.getElementById('ticker-marquee-clone');
  var priceChartEl = document.getElementById('priceChart');
  var crossCanvasEl = document.getElementById('crosshair-canvas');
  var chartContainerEl = priceChartEl ? priceChartEl.parentElement : null;
  var ttDateEl = document.getElementById('tt-date');
  var ttOpenEl = document.getElementById('tt-open');
  var ttHighEl = document.getElementById('tt-high');
  var ttLowEl = document.getElementById('tt-low');
  var ttCloseEl = document.getElementById('tt-close');
  var ttVolEl = document.getElementById('tt-vol');
  var pairBaseEl = document.getElementById('pair-base');
  var pairNameEl = document.getElementById('pair-name');
  var pairLogoEl = document.getElementById('pair-logo');
  var tradeAmountUnitEl = document.getElementById('trade-amount-unit');
  var assetSearchInput = document.getElementById('asset-search-input');
  var assetSearchDropdown = document.getElementById('asset-search-dropdown');

  var PORTFOLIO_KEY = 'nexus_portfolio_v1';
  var serverWalletUsdt = Number(window.__NEXUS_WALLET_USD__);
  var hasServerWalletUsdt = Number.isFinite(serverWalletUsdt) && serverWalletUsdt >= 0;
  var wallet = readPortfolioState();
  var holdings = wallet.holdings || {};
  var currentInterval = '1h';
  var currentPair = 'BTCUSDT';
  var currentBase = 'BTC';
  var klines = [];
  var currentPrice = 0;
  var ws = null;
  var reconnectTimer = null;
  var resizeTimer = null;
  var lastPrice = 0;
  var orderBook = { asks: [], bids: [] };
  var crossCtx = crossCanvasEl ? crossCanvasEl.getContext('2d') : null;
  var mouseX = 0;
  var mouseY = 0;
  var isMouseOnChart = false;
  var zoomStart = 0;
  var zoomEnd = 100;
  var visibleCandles = 100;
  var flashMeta = new WeakMap();
  var topTickers = [];
  var ASSET_META = {
    BTC: { name: 'Bitcoin', logo: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png' },
    ETH: { name: 'Ethereum', logo: 'https://cryptologos.cc/logos/ethereum-eth-logo.png' },
    BNB: { name: 'BNB', logo: 'https://cryptologos.cc/logos/bnb-bnb-logo.png' },
    SOL: { name: 'Solana', logo: 'https://cryptologos.cc/logos/solana-sol-logo.png' },
    XRP: { name: 'XRP', logo: 'https://cryptologos.cc/logos/xrp-xrp-logo.png' },
    ADA: { name: 'Cardano', logo: 'https://cryptologos.cc/logos/cardano-ada-logo.png' },
    DOGE: { name: 'Dogecoin', logo: 'https://cryptologos.cc/logos/dogecoin-doge-logo.png' },
    AVAX: { name: 'Avalanche', logo: 'https://cryptologos.cc/logos/avalanche-avax-logo.png' },
    DOT: { name: 'Polkadot', logo: 'https://cryptologos.cc/logos/polkadot-new-dot-logo.png' },
    LINK: { name: 'Chainlink', logo: 'https://cryptologos.cc/logos/chainlink-link-logo.png' },
  };
  var chartPadding = {
    top: 42,
    right: 76,
    bottom: 12,
    left: 12,
    volumeHeight: 70,
    volumeGap: 12,
  };

  function readPortfolioState() {
    if (Sync) {
      var synced = Sync.readPortfolio();
      return {
        usdt: Number(synced.cashUsd || 0),
        holdings: synced.holdings && typeof synced.holdings === 'object' ? synced.holdings : {},
      };
    }
    try {
      var raw = localStorage.getItem(PORTFOLIO_KEY);
      if (!raw) {
        return { usdt: hasServerWalletUsdt ? serverWalletUsdt : 50, holdings: {} };
      }
      var parsed = JSON.parse(raw);
      return {
        usdt: hasServerWalletUsdt ? serverWalletUsdt : Number(parsed.cashUsd || 50),
        holdings: parsed.holdings && typeof parsed.holdings === 'object' ? parsed.holdings : {},
      };
    } catch (error) {
      return { usdt: hasServerWalletUsdt ? serverWalletUsdt : 50, holdings: {} };
    }
  }

  function persistPortfolio() {
    if (Sync) {
      Sync.writePortfolio({
        cashUsd: Number(wallet.usdt || 0),
        todaysPnl: 0,
        holdings: holdings,
      }, { source: 'dashboard_spot' });
      return;
    }
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify({
      cashUsd: Number(wallet.usdt || 0),
      todaysPnl: 0,
      holdings: holdings,
    }));
  }

  function formatNumber(value, decimals) {
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
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
      availableUsdtEl.textContent = formatNumber(wallet.usdt, 2) + ' USDT';
    }
  }

  function updateTotals() {
    if (!feeEl || !totalEl) {
      return;
    }
    var price = Number(tradePriceEl && tradePriceEl.value ? tradePriceEl.value : 0);
    var amount = Number(tradeAmountEl && tradeAmountEl.value ? tradeAmountEl.value : 0);
    var subtotal = price * amount;
    var fee = subtotal * 0.001;
    var total = subtotal + fee;
    feeEl.textContent = formatNumber(fee, 2) + ' USDT';
    totalEl.textContent = formatNumber(total, 2) + ' USDT';
  }

  function setPctAmount(pct) {
    var price = Number(tradePriceEl && tradePriceEl.value ? tradePriceEl.value : 0);
    if (!price || price <= 0 || !tradeAmountEl) {
      return;
    }
    var amount = (wallet.usdt * pct) / price;
    tradeAmountEl.value = amount > 0 ? amount.toFixed(6) : '';
    updateTotals();
  }

  function flashElement(element, direction) {
    if (!element || !direction) {
      return;
    }
    var now = Date.now();
    var prev = flashMeta.get(element) || { ts: 0, timer: null };
    if ((now - prev.ts) < 240) {
      return;
    }

    if (prev.timer) {
      clearTimeout(prev.timer);
    }
    element.classList.remove('flash-green', 'flash-red');
    element.classList.add(direction === 'up' ? 'flash-green' : 'flash-red');

    var timer = window.setTimeout(function () {
      element.classList.remove('flash-green', 'flash-red');
    }, 900);
    flashMeta.set(element, { ts: now, timer: timer });
  }

  function updatePrice(newPrice) {
    var value = Number(newPrice || 0);
    if (!value || Number.isNaN(value)) {
      return;
    }
    if (lastPrice > 0) {
      if (value > lastPrice) {
        flashElement(livePriceEl, 'up');
        flashElement(lastPriceEl, 'up');
      } else if (value < lastPrice) {
        flashElement(livePriceEl, 'down');
        flashElement(lastPriceEl, 'down');
      }
    }
    lastPrice = value;
    if (livePriceEl) {
      livePriceEl.textContent = '$' + formatNumber(value, 2);
    }
    if (lastPriceEl) {
      lastPriceEl.textContent = '$' + formatNumber(value, 2);
    }
    if (tradePriceEl) {
      tradePriceEl.value = value.toFixed(2);
    }
    updateTotals();
  }

  function normalizePair(input) {
    var clean = String(input || '').trim().toUpperCase().replace(/[^A-Z0-9/]/g, '');
    if (!clean) {
      return 'BTCUSDT';
    }
    if (clean.indexOf('/') !== -1) {
      clean = clean.replace('/', '');
    }
    if (clean.endsWith('USDT') && clean.length > 4) {
      return clean;
    }
    return clean + 'USDT';
  }

  function updatePairUi() {
    var meta = ASSET_META[currentBase] || { name: currentBase, logo: '' };
    if (pairBaseEl) {
      pairBaseEl.textContent = currentBase;
    }
    if (pairNameEl) {
      pairNameEl.textContent = meta.name;
    }
    if (pairLogoEl && meta.logo) {
      pairLogoEl.src = meta.logo;
      pairLogoEl.alt = meta.name;
    }
    if (tradeAmountUnitEl) {
      tradeAmountUnitEl.textContent = currentBase;
    }
    if (buyBtn) {
      buyBtn.textContent = 'Buy ' + currentBase;
    }
    if (sellBtn) {
      sellBtn.textContent = 'Sell ' + currentBase;
    }
  }

  function update24hStats(data) {
    var change = Number(data.P || 0);
    var high = Number(data.h || 0);
    var low = Number(data.l || 0);
    var volumeBtc = Number(data.v || 0);
    var volumeUsdt = Number(data.q || 0);
    if (liveChangeEl) {
      liveChangeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
      liveChangeEl.classList.remove('positive', 'negative');
      liveChangeEl.classList.add(change >= 0 ? 'positive' : 'negative');
    }
    if (statChangeEl) {
      statChangeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
      statChangeEl.classList.remove('positive', 'negative');
      statChangeEl.classList.add(change >= 0 ? 'positive' : 'negative');
    }
    if (statHighEl) {
      statHighEl.textContent = formatNumber(high, 2);
    }
    if (statLowEl) {
      statLowEl.textContent = formatNumber(low, 2);
    }
    if (statVolBtcEl) {
      statVolBtcEl.textContent = formatNumber(volumeBtc, 4);
    }
    if (statVolUsdtEl) {
      statVolUsdtEl.textContent = formatNumber(volumeUsdt, 2);
    }
    updatePrice(Number(data.c || 0));
  }

  function buildOrderRows(container, rows, type) {
    if (!container) {
      return;
    }
    var safeRows = rows.slice(0, 12);
    while (safeRows.length < 12) {
      safeRows.push([0, 0]);
    }
    var maxAmount = safeRows.reduce(function (acc, row) {
      var amount = Number(row[1] || 0);
      return amount > acc ? amount : acc;
    }, 0) || 1;
    var runningTotal = 0;
    container.innerHTML = safeRows.map(function (row) {
      var price = Number(row[0] || 0);
      var amount = Number(row[1] || 0);
      runningTotal += amount;
      var depthWidth = (amount / maxAmount) * 100;
      var barColor = type === 'ask' ? '#f6465d' : '#0ecb81';
      return (
        '<div class="ob-row ' + (type === 'ask' ? 'sell' : 'buy') + '">' +
          '<div class="depth-bar" style="width:' + depthWidth.toFixed(2) + '%; background:' + barColor + ';"></div>' +
          '<span>' + (price ? formatNumber(price, 2) : '--') + '</span>' +
          '<span>' + (amount ? formatNumber(amount, 6) : '--') + '</span>' +
          '<span>' + (amount ? formatNumber(runningTotal, 6) : '--') + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function renderOrderBook() {
    var asks = orderBook.asks.slice().sort(function (a, b) {
      return Number(b[0]) - Number(a[0]);
    }).slice(0, 12);
    var bids = orderBook.bids.slice().sort(function (a, b) {
      return Number(b[0]) - Number(a[0]);
    }).slice(0, 12);
    buildOrderRows(asksListEl, asks, 'ask');
    buildOrderRows(bidsListEl, bids, 'bid');
  }

  function getDprScale() {
    if (!priceChartEl || !priceChartEl.offsetWidth) {
      return 1;
    }
    return priceChartEl.width / priceChartEl.offsetWidth;
  }

  function getCrossPadding() {
    var scale = getDprScale();
    return {
      top: chartPadding.top * scale,
      right: chartPadding.right * scale,
      bottom: chartPadding.bottom * scale,
      left: chartPadding.left * scale,
      volumeHeight: chartPadding.volumeHeight * scale,
      volumeGap: chartPadding.volumeGap * scale,
    };
  }

  function getVisibleKlines() {
    if (!klines.length) {
      return [];
    }
    var safeStart = Math.max(0, Math.floor(zoomStart));
    var safeEnd = Math.min(klines.length, Math.floor(zoomEnd));
    if (safeEnd <= safeStart) {
      return klines.slice(0);
    }
    return klines.slice(safeStart, safeEnd);
  }

  function resetZoom() {
    if (!klines.length) {
      zoomStart = 0;
      zoomEnd = 0;
      visibleCandles = 0;
      return;
    }
    zoomStart = 0;
    zoomEnd = klines.length;
    visibleCandles = klines.length;
  }

  function clampZoomWindow() {
    if (!klines.length) {
      zoomStart = 0;
      zoomEnd = 0;
      visibleCandles = 0;
      return;
    }
    visibleCandles = Math.max(10, Math.min(200, Math.round(visibleCandles || klines.length)));
    visibleCandles = Math.min(visibleCandles, klines.length);
    zoomStart = Math.max(0, Math.floor(zoomStart));
    zoomEnd = Math.min(klines.length, Math.floor(zoomEnd));
    if (zoomEnd - zoomStart < visibleCandles) {
      zoomEnd = Math.min(klines.length, zoomStart + visibleCandles);
      if (zoomEnd - zoomStart < visibleCandles) {
        zoomStart = Math.max(0, zoomEnd - visibleCandles);
      }
    }
  }

  function getPriceFromY(y) {
    var visibleKlines = getVisibleKlines();
    if (!visibleKlines.length || !crossCanvasEl) {
      return currentPrice || 0;
    }
    var padding = getCrossPadding();
    var priceBottom = crossCanvasEl.height - padding.bottom - padding.volumeHeight - padding.volumeGap;
    var chartH = Math.max(1, priceBottom - padding.top);
    var clampedY = Math.max(padding.top, Math.min(priceBottom, y));
    var prices = visibleKlines.flatMap(function (k) {
      return [parseFloat(k[2]), parseFloat(k[3])];
    });
    var minP = Math.min.apply(null, prices);
    var maxP = Math.max.apply(null, prices);
    var range = maxP - minP || 1;
    var minPrice = minP - range * 0.05;
    var maxPrice = maxP + range * 0.05;
    var ratio = 1 - (clampedY - padding.top) / chartH;
    return minPrice + ratio * (maxPrice - minPrice);
  }

  function getTimeFromX(x) {
    var visibleKlines = getVisibleKlines();
    if (!visibleKlines.length || !crossCanvasEl) {
      return null;
    }
    var padding = getCrossPadding();
    var chartW = crossCanvasEl.width - padding.left - padding.right;
    var spacing = chartW / visibleKlines.length;
    var index = Math.floor((x - padding.left) / spacing);
    if (index < 0 || index >= visibleKlines.length) {
      return null;
    }
    var timestamp = Number(visibleKlines[index][0]);
    var date = new Date(timestamp);
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function updateTooltip(x) {
    var visibleKlines = getVisibleKlines();
    if (!visibleKlines.length || !crossCanvasEl || !ttDateEl) {
      return;
    }
    var padding = getCrossPadding();
    var chartW = crossCanvasEl.width - padding.left - padding.right;
    var spacing = chartW / visibleKlines.length;
    var index = Math.floor((x - padding.left) / spacing);
    if (index < 0 || index >= visibleKlines.length) {
      return;
    }
    var k = visibleKlines[index];
    var date = new Date(Number(k[0]));
    var dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    ttDateEl.textContent = dateStr;
    if (ttOpenEl) { ttOpenEl.textContent = parseFloat(k[1]).toFixed(2); }
    if (ttHighEl) { ttHighEl.textContent = parseFloat(k[2]).toFixed(2); }
    if (ttLowEl) { ttLowEl.textContent = parseFloat(k[3]).toFixed(2); }
    if (ttCloseEl) { ttCloseEl.textContent = parseFloat(k[4]).toFixed(2); }
    if (ttVolEl) { ttVolEl.textContent = parseFloat(k[5]).toFixed(2); }
  }

  function showLastCandleTooltip() {
    var visibleKlines = getVisibleKlines();
    if (!visibleKlines.length || !ttDateEl) {
      return;
    }
    var last = visibleKlines[visibleKlines.length - 1];
    var date = new Date(Number(last[0]));
    ttDateEl.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    if (ttOpenEl) { ttOpenEl.textContent = parseFloat(last[1]).toFixed(2); }
    if (ttHighEl) { ttHighEl.textContent = parseFloat(last[2]).toFixed(2); }
    if (ttLowEl) { ttLowEl.textContent = parseFloat(last[3]).toFixed(2); }
    if (ttCloseEl) { ttCloseEl.textContent = parseFloat(last[4]).toFixed(2); }
    if (ttVolEl) { ttVolEl.textContent = parseFloat(last[5]).toFixed(2); }
  }

  function clearCrosshair() {
    if (!crossCtx || !crossCanvasEl) {
      return;
    }
    crossCtx.clearRect(0, 0, crossCanvasEl.width, crossCanvasEl.height);
  }

  function drawCrosshair() {
    if (!crossCtx || !crossCanvasEl || !isMouseOnChart) {
      return;
    }
    clearCrosshair();
    var padding = getCrossPadding();
    var priceBottom = crossCanvasEl.height - padding.bottom - padding.volumeHeight - padding.volumeGap;
    var clampedX = Math.max(padding.left, Math.min(crossCanvasEl.width - padding.right, mouseX));
    var clampedY = Math.max(padding.top, Math.min(priceBottom, mouseY));

    if (mouseX > crossCanvasEl.width - padding.right) {
      return;
    }

    crossCtx.setLineDash([4, 4]);
    crossCtx.strokeStyle = 'rgba(255,255,255,0.3)';
    crossCtx.lineWidth = 1;
    crossCtx.beginPath();
    crossCtx.moveTo(clampedX, padding.top);
    crossCtx.lineTo(clampedX, priceBottom);
    crossCtx.stroke();
    crossCtx.beginPath();
    crossCtx.moveTo(padding.left, clampedY);
    crossCtx.lineTo(crossCanvasEl.width - padding.right, clampedY);
    crossCtx.stroke();
    crossCtx.setLineDash([]);

    var priceAtCursor = getPriceFromY(clampedY);
    crossCtx.fillStyle = '#9b51e0';
    crossCtx.fillRect(crossCanvasEl.width - padding.right, clampedY - 10, padding.right, 20);
    crossCtx.fillStyle = 'white';
    crossCtx.font = 'bold 9px JetBrains Mono';
    crossCtx.textAlign = 'left';
    crossCtx.fillText(priceAtCursor.toFixed(2), crossCanvasEl.width - padding.right + 3, clampedY + 4);

    var timeAtCursor = getTimeFromX(clampedX);
    if (timeAtCursor) {
      var textW = crossCtx.measureText(timeAtCursor).width + 10;
      crossCtx.fillStyle = '#1e2329';
      crossCtx.fillRect(clampedX - textW / 2, crossCanvasEl.height - padding.bottom, textW, 16);
      crossCtx.fillStyle = 'white';
      crossCtx.font = '9px JetBrains Mono';
      crossCtx.textAlign = 'center';
      crossCtx.fillText(timeAtCursor, clampedX, crossCanvasEl.height - padding.bottom + 11);
    }

    crossCtx.fillStyle = 'rgba(255,255,255,0.8)';
    crossCtx.beginPath();
    crossCtx.arc(clampedX, clampedY, 3, 0, Math.PI * 2);
    crossCtx.fill();
  }

  function resizeCrossCanvas() {
    if (!crossCanvasEl || !priceChartEl) {
      return;
    }
    crossCanvasEl.width = priceChartEl.width;
    crossCanvasEl.height = priceChartEl.height;
    clearCrosshair();
    if (isMouseOnChart) {
      drawCrosshair();
    }
  }

  function resizeCanvas() {
    if (!priceChartEl) {
      return;
    }
    var width = priceChartEl.offsetWidth;
    var height = priceChartEl.offsetHeight;
    if (!width || !height) {
      return;
    }
    var dpr = window.devicePixelRatio || 1;
    priceChartEl.width = Math.max(1, Math.floor(width * dpr));
    priceChartEl.height = Math.max(1, Math.floor(height * dpr));
    var ctx = priceChartEl.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    resizeCrossCanvas();
    drawChart();
  }

  function drawChart() {
    if (!priceChartEl) {
      return;
    }
    var ctx = priceChartEl.getContext('2d');
    var width = priceChartEl.offsetWidth;
    var height = priceChartEl.offsetHeight;
    if (!width || !height) {
      return;
    }
    ctx.clearRect(0, 0, width, height);
    if (!klines.length) {
      ctx.fillStyle = '#848e9c';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('Loading chart...', 14, 22);
      return;
    }

    clampZoomWindow();
    var visibleKlines = getVisibleKlines();
    if (!visibleKlines.length) {
      return;
    }

    var paddingTop = chartPadding.top;
    var paddingLeft = chartPadding.left;
    var paddingRight = chartPadding.right;
    var paddingBottom = chartPadding.bottom;
    var volumeHeight = chartPadding.volumeHeight;
    var volumeGap = chartPadding.volumeGap;
    var priceBottom = height - paddingBottom - volumeHeight - volumeGap;
    var priceHeight = Math.max(100, priceBottom - paddingTop);
    var chartWidth = Math.max(1, width - paddingLeft - paddingRight);

    var prices = visibleKlines.flatMap(function (k) {
      return [parseFloat(k[2]), parseFloat(k[3])];
    });
    var minP = Math.min.apply(null, prices);
    var maxP = Math.max.apply(null, prices);
    var range = maxP - minP || 1;
    var minPrice = minP - range * 0.05;
    var maxPrice = maxP + range * 0.05;

    var candleSlot = chartWidth / visibleKlines.length;
    var candleWidth = Math.max(2, Math.min(10, candleSlot * 0.6));
    var maxVolume = Math.max.apply(null, visibleKlines.map(function (k) { return parseFloat(k[5]); })) || 1;

    var yPos = function (price) {
      return paddingTop + priceHeight - ((price - minPrice) / (maxPrice - minPrice)) * priceHeight;
    };

    function xPos(index) {
      return paddingLeft + candleSlot * index + candleSlot / 2;
    }

    var gridLines = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (var i = 0; i <= gridLines; i += 1) {
      var gy = paddingTop + (priceHeight / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, gy);
      ctx.lineTo(width - paddingRight, gy);
      ctx.stroke();
    }

    visibleKlines.forEach(function (kline, index) {
      var open = parseFloat(kline[1]);
      var high = parseFloat(kline[2]);
      var low = parseFloat(kline[3]);
      var close = parseFloat(kline[4]);
      var volume = parseFloat(kline[5]);
      var x = xPos(index);
      var openY = yPos(open);
      var closeY = yPos(close);
      var highY = yPos(high);
      var lowY = yPos(low);
      var isUp = close >= open;
      var bodyTop = Math.min(openY, closeY);
      var bodyBottom = Math.max(openY, closeY);
      var bodyHeight = Math.max(1, bodyBottom - bodyTop);
      var color = isUp ? '#0ecb81' : '#f6465d';

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);

      var volRatio = volume / maxVolume;
      var volHeight = Math.max(1, volRatio * volumeHeight);
      var volY = height - paddingBottom - volHeight;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x - candleWidth / 2, volY, candleWidth, volHeight);
      ctx.globalAlpha = 1;
    });

    var lastClose = parseFloat(visibleKlines[visibleKlines.length - 1][4]);
    if (!currentPrice || Number.isNaN(currentPrice)) {
      currentPrice = lastClose;
    }
    var currentY = yPos(currentPrice);
    ctx.save();
    ctx.strokeStyle = '#9b51e0';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(paddingLeft, currentY);
    ctx.lineTo(width - paddingRight + 2, currentY);
    ctx.stroke();
    ctx.restore();

    var labelText = formatNumber(currentPrice, 2);
    ctx.font = '12px Roboto Mono, monospace';
    var textW = ctx.measureText(labelText).width;
    var labelW = textW + 14;
    var labelH = 20;
    var labelX = width - labelW - 8;
    var labelY = Math.max(4, Math.min(height - labelH - 4, currentY - labelH / 2));
    ctx.fillStyle = '#181a20';
    ctx.fillRect(labelX, labelY, labelW, labelH);
    ctx.strokeStyle = '#9b51e0';
    ctx.strokeRect(labelX, labelY, labelW, labelH);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(labelText, labelX + 7, labelY + 14);

    if (isMouseOnChart) {
      drawCrosshair();
    } else {
      showLastCandleTooltip();
    }
  }

  function fetchCandles(interval) {
    var api = 'https://api.binance.com/api/v3/klines?symbol=' + encodeURIComponent(currentPair) + '&interval=' + encodeURIComponent(interval) + '&limit=100';
    return fetch(api)
      .then(function (res) {
        if (!res.ok) {
          throw new Error('kline fetch failed');
        }
        return res.json();
      })
      .then(function (data) {
        klines = Array.isArray(data) ? data : [];
        if (!klines.length) {
          throw new Error('No candles');
        }
        currentPrice = parseFloat(data[data.length - 1][4]);
        updatePrice(currentPrice);
        resetZoom();
        resizeCanvas();
        showLastCandleTooltip();
      })
      .catch(function () {
        if (!klines.length) {
          var base = currentPrice || lastPrice || 64321;
          klines = [];
          for (var i = 0; i < 100; i += 1) {
            var drift = Math.sin(i / 10) * 65;
            var open = base + drift;
            var close = open + Math.cos(i / 9) * 35;
            klines.push([
              Date.now() - (100 - i) * 3600000,
              open.toString(),
              (Math.max(open, close) + 22).toString(),
              (Math.min(open, close) - 22).toString(),
              close.toString(),
              (8 + i * 0.3).toString(),
              Date.now(),
            ]);
          }
          currentPrice = parseFloat(klines[klines.length - 1][4]);
          updatePrice(currentPrice);
          resetZoom();
          resizeCanvas();
          showLastCandleTooltip();
        }
      });
  }

  function updateKline(kline) {
    if (!kline) {
      return;
    }
    var next = [
      Number(kline.t),
      String(kline.o),
      String(kline.h),
      String(kline.l),
      String(kline.c),
      String(kline.v),
      Number(kline.T),
    ];
    if (!klines.length) {
      klines = [next];
    } else {
      var last = klines[klines.length - 1];
      if (Number(last[0]) === Number(next[0])) {
        klines[klines.length - 1] = next;
      } else {
        klines.push(next);
        if (klines.length > 100) {
          klines = klines.slice(klines.length - 100);
        }
      }
    }
    currentPrice = parseFloat(kline.c);
    updatePrice(currentPrice);
    clampZoomWindow();
    drawChart();
  }

  function updateTickerStrip(items) {
    if (!Array.isArray(items) || !tickerMarquee || !tickerMarqueeClone) {
      return;
    }
    var top = items
      .filter(function (item) { return String(item.s || '').endsWith('USDT'); })
      .sort(function (a, b) { return Number(b.q || 0) - Number(a.q || 0); })
      .slice(0, 10);
    var html = top.map(function (item) {
      var pct = Number(item.P || 0);
      var cls = pct >= 0 ? 'up' : 'down';
      var sign = pct >= 0 ? '+' : '';
      return '<span class="ticker-item"><b>' + item.s + '</b> ' + formatNumber(item.c, 4) + ' <span class="' + cls + '">' + sign + pct.toFixed(2) + '%</span></span>';
    }).join('');
    tickerMarquee.innerHTML = html;
    tickerMarqueeClone.innerHTML = html;
  }

  function connectWS() {
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    var pairLower = currentPair.toLowerCase();
    var streamUrl = 'wss://stream.binance.com:9443/stream?streams=' +
      pairLower + '@ticker/' +
      pairLower + '@depth20@100ms/' +
      pairLower + '@kline_' + currentInterval +
      '/!miniTicker@arr';
    ws = new WebSocket(streamUrl);

    ws.onmessage = function (event) {
      var payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      var data = payload && payload.data ? payload.data : payload;
      if (!data) {
        return;
      }
      if (data.e === '24hrTicker') {
        currentPrice = parseFloat(data.c || 0);
        drawChart();
        update24hStats(data);
        return;
      }
      if (data.asks && data.bids) {
        orderBook.asks = data.asks;
        orderBook.bids = data.bids;
        renderOrderBook();
        return;
      }
      if (data.e === 'kline') {
        updateKline(data.k);
        return;
      }
      if (Array.isArray(data)) {
        updateTickerStrip(data);
      }
    };

    ws.onerror = function () {
      if (ws) {
        ws.close();
      }
    };

    ws.onclose = function () {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      reconnectTimer = setTimeout(connectWS, 5000);
    };
  }

  function buyNow() {
    var price = Number(tradePriceEl && tradePriceEl.value ? tradePriceEl.value : 0);
    var amount = Number(tradeAmountEl && tradeAmountEl.value ? tradeAmountEl.value : 0);
    if (!price || !amount || amount <= 0) {
      setFeedback('Enter valid price and amount.', 'error');
      return;
    }
    var subtotal = price * amount;
    var fee = subtotal * 0.001;
    var total = subtotal + fee;
    if (total > wallet.usdt) {
      setFeedback('Not enough USDT for this order.', 'error');
      return;
    }
    wallet.usdt -= total;
    holdings[currentBase] = Number(holdings[currentBase] || 0) + amount;
    persistPortfolio();
    if (Sync) {
      Sync.recordTrade({
        type: 'Spot',
        side: 'Buy',
        pair: currentBase + '/USDT',
        asset: currentBase,
        amount: amount,
        amountText: '+' + amount.toFixed(6) + ' ' + currentBase,
        price: price,
        fee: fee,
        total: total,
        note: 'Spot buy executed',
        source: 'dashboard_spot',
      });
    }
    updateAvailable();
    updateTotals();
    setFeedback('Buy order executed (simulation).', 'success');
  }

  function sellNow() {
    var price = Number(tradePriceEl && tradePriceEl.value ? tradePriceEl.value : 0);
    var amount = Number(tradeAmountEl && tradeAmountEl.value ? tradeAmountEl.value : 0);
    if (!price || !amount || amount <= 0) {
      setFeedback('Enter valid price and amount.', 'error');
      return;
    }
    var current = Number(holdings[currentBase] || 0);
    if (amount > current) {
      setFeedback('Not enough BTC to sell.', 'error');
      return;
    }
    var subtotal = price * amount;
    var fee = subtotal * 0.001;
    wallet.usdt += subtotal - fee;
    holdings[currentBase] = current - amount;
    if (holdings[currentBase] <= 0) {
      delete holdings[currentBase];
    }
    persistPortfolio();
    if (Sync) {
      Sync.recordTrade({
        type: 'Spot',
        side: 'Sell',
        pair: currentBase + '/USDT',
        asset: currentBase,
        amount: amount,
        amountText: '-' + amount.toFixed(6) + ' ' + currentBase,
        price: price,
        fee: fee,
        total: subtotal - fee,
        note: 'Spot sell executed',
        source: 'dashboard_spot',
      });
    }
    updateAvailable();
    updateTotals();
    setFeedback('Sell order executed (simulation).', 'success');
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

  modeTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      modeTabs.forEach(function (item) { item.classList.remove('active'); });
      tab.classList.add('active');
    });
  });

  orderTypeTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      orderTypeTabs.forEach(function (item) { item.classList.remove('active'); });
      tab.classList.add('active');
    });
  });

  timeframeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      timeframeButtons.forEach(function (item) { item.classList.remove('active'); });
      btn.classList.add('active');
      currentInterval = btn.getAttribute('data-interval') || '1h';
      fetchCandles(currentInterval).then(function () {
        connectWS();
      });
    });
  });

  pctButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      pctButtons.forEach(function (item) { item.classList.remove('active'); });
      btn.classList.add('active');
      setPctAmount(Number(btn.getAttribute('data-pct') || 0));
    });
  });

  if (tradeAmountEl) {
    tradeAmountEl.addEventListener('input', updateTotals);
  }
  if (tradePriceEl) {
    tradePriceEl.addEventListener('input', updateTotals);
  }
  if (buyBtn) {
    buyBtn.addEventListener('click', buyNow);
  }
  if (sellBtn) {
    sellBtn.addEventListener('click', sellNow);
  }

  if (chartContainerEl && priceChartEl && crossCanvasEl) {
    chartContainerEl.addEventListener('mousemove', function (e) {
      var rect = priceChartEl.getBoundingClientRect();
      mouseX = (e.clientX - rect.left) * (priceChartEl.width / rect.width);
      mouseY = (e.clientY - rect.top) * (priceChartEl.height / rect.height);
      isMouseOnChart = true;
      updateTooltip(mouseX);
      drawCrosshair();
    });

    chartContainerEl.addEventListener('mouseleave', function () {
      isMouseOnChart = false;
      clearCrosshair();
      showLastCandleTooltip();
    });

    chartContainerEl.addEventListener('wheel', function (e) {
      if (!klines.length) {
        return;
      }
      e.preventDefault();
      var zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      var centerIndex = Math.floor(zoomStart + visibleCandles / 2);
      visibleCandles = Math.round(visibleCandles * zoomFactor);
      visibleCandles = Math.max(10, Math.min(200, visibleCandles));
      visibleCandles = Math.min(visibleCandles, klines.length);
      zoomStart = Math.max(0, centerIndex - visibleCandles / 2);
      zoomEnd = Math.min(klines.length, zoomStart + visibleCandles);
      if (zoomEnd === klines.length) {
        zoomStart = Math.max(0, zoomEnd - visibleCandles);
      }
      drawChart();
      updateTooltip(mouseX);
      drawCrosshair();
    }, { passive: false });
  }

  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 100);
  });

  if (Sync) {
    Sync.onPortfolioChange(function (state) {
      wallet.usdt = Number(state.cashUsd || 0);
      holdings = state.holdings && typeof state.holdings === 'object' ? state.holdings : {};
      updateAvailable();
      updateTotals();
    }, { immediate: false });
  } else {
    window.addEventListener('storage', function (event) {
      if (event.key !== PORTFOLIO_KEY) {
        return;
      }
      wallet = readPortfolioState();
      holdings = wallet.holdings || {};
      updateAvailable();
      updateTotals();
    });
  }

  updateAvailable();
  updateTotals();
  updatePairUi();
  resizeCanvas();
  drawChart();

  setTimeout(function () {
    fetchCandles(currentInterval).then(function () {
      connectWS();
    });
  }, 100);

  function renderAssetSearch(items) {
    if (!assetSearchDropdown) {
      return;
    }
    if (!items.length) {
      assetSearchDropdown.classList.remove('show');
      assetSearchDropdown.innerHTML = '';
      return;
    }
    assetSearchDropdown.innerHTML = items.map(function (item) {
      var symbol = String(item.symbol || '').toUpperCase();
      var base = symbol.replace('USDT', '');
      var name = (ASSET_META[base] && ASSET_META[base].name) ? ASSET_META[base].name : base;
      return '<div class="asset-option" data-pair="' + symbol + '"><span class="asset-symbol">' + symbol + '</span><span class="asset-name">' + name + '</span></div>';
    }).join('');
    assetSearchDropdown.classList.add('show');
  }

  function setCurrentPair(nextPair) {
    var normalized = normalizePair(nextPair);
    if (normalized === currentPair) {
      return;
    }
    currentPair = normalized;
    currentBase = normalized.replace('USDT', '');
    orderBook = { asks: [], bids: [] };
    if (asksListEl) {
      asksListEl.innerHTML = '';
    }
    if (bidsListEl) {
      bidsListEl.innerHTML = '';
    }
    updatePairUi();
    setFeedback('Switched to ' + currentPair + ' live feed.', 'success');
    fetchCandles(currentInterval).then(function () {
      connectWS();
    });
  }

  function loadTopTickers() {
    return fetch('/api/market/tickers/')
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        if (!payload || !payload.ok || !Array.isArray(payload.rows)) {
          throw new Error('Ticker list unavailable');
        }
        topTickers = payload.rows.filter(function (item) {
          return String(item.symbol || '').endsWith('USDT');
        }).slice(0, 100);
      })
      .catch(function () {
        topTickers = [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }, { symbol: 'BNBUSDT' }, { symbol: 'SOLUSDT' }, { symbol: 'XRPUSDT' }];
      });
  }

  loadTopTickers();

  if (assetSearchInput && assetSearchDropdown) {
    assetSearchInput.addEventListener('input', function () {
      var q = String(assetSearchInput.value || '').trim().toUpperCase();
      if (!q) {
        assetSearchDropdown.classList.remove('show');
        assetSearchDropdown.innerHTML = '';
        return;
      }
      var matches = topTickers.filter(function (item) {
        var symbol = String(item.symbol || '').toUpperCase();
        var base = symbol.replace('USDT', '');
        var name = (ASSET_META[base] && ASSET_META[base].name ? ASSET_META[base].name : '').toUpperCase();
        return symbol.indexOf(q) !== -1 || base.indexOf(q) !== -1 || name.indexOf(q) !== -1;
      }).slice(0, 12);
      renderAssetSearch(matches);
    });

    assetSearchDropdown.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('.asset-option') : null;
      if (!target) {
        return;
      }
      var pair = target.getAttribute('data-pair') || 'BTCUSDT';
      setCurrentPair(pair);
      assetSearchInput.value = pair;
      assetSearchDropdown.classList.remove('show');
      assetSearchDropdown.innerHTML = '';
    });

    document.addEventListener('click', function (event) {
      if (!assetSearchDropdown.contains(event.target) && event.target !== assetSearchInput) {
        assetSearchDropdown.classList.remove('show');
      }
    });
  }
});
