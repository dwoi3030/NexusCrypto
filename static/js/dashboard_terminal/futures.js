document.addEventListener('DOMContentLoaded', function () {
  var PORTFOLIO_KEY = 'nexus_portfolio_v1';
  var FUTURES_KEY = 'nexus_futures_positions_v1';
  var DEFAULT_LEVERAGE = 20;
  var currentPair = 'BTCUSDT';
  var currentBase = 'BTC';
  var markPrice = 64321;
  var price24hChange = 0;
  var high24h = 0;
  var low24h = 0;
  var volume24h = 0;
  var candleLimit = 90;
  var latestCandleRows = [];
  var chartHover = { active: false, x: 0, y: 0 };

  var walletUsdtEl = document.getElementById('wallet-usdt');
  var availableBalanceEl = document.getElementById('available-balance');
  var markPriceEl = document.getElementById('mark-price');
  var change24hEl = document.getElementById('change-24h');
  var high24hEl = document.getElementById('high-24h');
  var low24hEl = document.getElementById('low-24h');
  var volume24hEl = document.getElementById('volume-24h');
  var pairLabelEl = document.getElementById('pair-label');
  var priceInput = document.getElementById('price-input');
  var sizeInput = document.getElementById('size-input');
  var sizeUnitEl = document.getElementById('size-unit');
  var pairSelect = document.getElementById('pair-select');
  var estMarginEl = document.getElementById('est-margin');
  var estFeeEl = document.getElementById('est-fee');
  var tradeFeedbackEl = document.getElementById('trade-feedback');
  var countdownEl = document.getElementById('countdown');
  var buyBtn = document.getElementById('buy-btn');
  var sellBtn = document.getElementById('sell-btn');
  var asksEl = document.getElementById('asks');
  var bidsEl = document.getElementById('bids');
  var midPriceEl = document.getElementById('mid-price');
  var spreadValueEl = document.getElementById('spread-value');
  var chartEl = document.getElementById('candlestick-chart');
  var positionsBodyEl = document.getElementById('positions-body');
  var posCountEl = document.getElementById('pos-count');
  var marqueeEl = document.getElementById('marquee');
  var marqueeCloneEl = document.getElementById('marquee-clone');
  var tpslToggleEl = document.getElementById('tpsl-toggle');
  var tpslInputsEl = document.getElementById('tpsl-inputs');

  var portfolio = readPortfolio();
  var futuresState = readFutures();

  function readPortfolio() {
    try {
      var raw = localStorage.getItem(PORTFOLIO_KEY);
      if (!raw) {
        return { cashUsd: 50, todaysPnl: 50, holdings: {} };
      }
      var parsed = JSON.parse(raw);
      return {
        cashUsd: Number(parsed.cashUsd || 0),
        todaysPnl: Number(parsed.todaysPnl || 0),
        holdings: parsed.holdings && typeof parsed.holdings === 'object' ? parsed.holdings : {},
      };
    } catch (error) {
      return { cashUsd: 50, todaysPnl: 50, holdings: {} };
    }
  }

  function writePortfolio() {
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify({
      cashUsd: Number(portfolio.cashUsd || 0),
      todaysPnl: Number(portfolio.todaysPnl || 0),
      holdings: portfolio.holdings || {},
    }));
  }

  function readFutures() {
    try {
      var raw = localStorage.getItem(FUTURES_KEY);
      if (!raw) {
        return [];
      }
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writeFutures() {
    localStorage.setItem(FUTURES_KEY, JSON.stringify(futuresState));
  }

  function formatUsd(value) {
    return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct(value) {
    var sign = value >= 0 ? '+' : '';
    return sign + Number(value || 0).toFixed(2) + '%';
  }

  function formatBaseVolume(value) {
    var vol = Number(value || 0);
    if (vol >= 1000) {
      return vol.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return vol.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function setFeedback(message, kind) {
    if (!tradeFeedbackEl) {
      return;
    }
    tradeFeedbackEl.textContent = message;
    if (kind === 'success') {
      tradeFeedbackEl.style.color = '#0ecb81';
      return;
    }
    if (kind === 'error') {
      tradeFeedbackEl.style.color = '#f6465d';
      return;
    }
    tradeFeedbackEl.style.color = '#94a3b8';
  }

  function renderWallet() {
    var text = formatUsd(portfolio.cashUsd);
    if (walletUsdtEl) {
      walletUsdtEl.innerHTML = text + ' <span>USDT</span>';
    }
    if (availableBalanceEl) {
      availableBalanceEl.textContent = text + ' USDT';
    }
  }

  function renderStats() {
    if (pairLabelEl) {
      pairLabelEl.textContent = currentPair;
    }
    if (markPriceEl) {
      markPriceEl.textContent = formatUsd(markPrice);
      markPriceEl.classList.toggle('positive', price24hChange >= 0);
      markPriceEl.classList.toggle('negative', price24hChange < 0);
    }
    if (change24hEl) {
      change24hEl.textContent = formatPct(price24hChange);
      change24hEl.classList.toggle('positive', price24hChange >= 0);
      change24hEl.classList.toggle('negative', price24hChange < 0);
    }
    if (high24hEl) {
      high24hEl.textContent = formatUsd(high24h);
    }
    if (low24hEl) {
      low24hEl.textContent = formatUsd(low24h);
    }
    if (volume24hEl) {
      volume24hEl.textContent = formatBaseVolume(volume24h) + ' ' + currentBase;
    }
    if (priceInput) {
      priceInput.value = Number(markPrice).toFixed(2);
    }
  }

  function renderEstimates() {
    var price = Number(priceInput && priceInput.value ? priceInput.value : markPrice);
    var size = Number(sizeInput && sizeInput.value ? sizeInput.value : 0);
    var notional = price * size;
    var margin = notional / DEFAULT_LEVERAGE;
    var fee = notional * 0.0004;
    if (estMarginEl) {
      estMarginEl.textContent = formatUsd(margin) + ' USDT';
    }
    if (estFeeEl) {
      estFeeEl.textContent = formatUsd(fee) + ' USDT';
    }
  }

  function renderOrderBook(payload) {
    if (!asksEl || !bidsEl) {
      return;
    }
    var asks = (payload && payload.asks ? payload.asks : []).slice(0, 15);
    var bids = (payload && payload.bids ? payload.bids : []).slice(0, 15);

    var askRows = '';
    var bidRows = '';
    var askRowsData = asks.map(function (a) {
      var price = Number(a[0] || 0);
      var qty = Number(a[1] || 0);
      return { price: price, qty: qty, total: price * qty };
    });
    var bidRowsData = bids.map(function (b) {
      var price = Number(b[0] || 0);
      var qty = Number(b[1] || 0);
      return { price: price, qty: qty, total: price * qty };
    });
    var maxAskTotal = Math.max.apply(null, askRowsData.map(function (row) { return row.total; }).concat([1]));
    var maxBidTotal = Math.max.apply(null, bidRowsData.map(function (row) { return row.total; }).concat([1]));

    for (var i = askRowsData.length - 1; i >= 0; i -= 1) {
      var a = askRowsData[i];
      var askDepthWidth = Math.min(100, (a.total / maxAskTotal) * 100);
      askRows += '<div class="ob-row"><div class="depth-bar ask-depth" style="width:' + askDepthWidth.toFixed(2) + '%"></div><span style="color:#f6465d">' + a.price.toFixed(2) + '</span><span>' + a.qty.toFixed(4) + '</span><span>' + a.total.toFixed(2) + '</span></div>';
    }

    for (var j = 0; j < bidRowsData.length; j += 1) {
      var b = bidRowsData[j];
      var bidDepthWidth = Math.min(100, (b.total / maxBidTotal) * 100);
      bidRows += '<div class="ob-row"><div class="depth-bar bid-depth" style="width:' + bidDepthWidth.toFixed(2) + '%"></div><span style="color:#0ecb81">' + b.price.toFixed(2) + '</span><span>' + b.qty.toFixed(4) + '</span><span>' + b.total.toFixed(2) + '</span></div>';
    }

    asksEl.innerHTML = askRows;
    bidsEl.innerHTML = bidRows;
    asksEl.scrollTop = asksEl.scrollHeight;

    var bestAsk = asks.length ? Number(asks[0][0]) : markPrice;
    var bestBid = bids.length ? Number(bids[0][0]) : markPrice;
    var mid = (bestAsk + bestBid) / 2;
    var spread = Math.max(0, bestAsk - bestBid);
    var spreadPct = mid ? (spread / mid) * 100 : 0;
    markPrice = mid || markPrice;
    if (midPriceEl) {
      midPriceEl.textContent = formatUsd(mid);
    }
    if (spreadValueEl) {
      spreadValueEl.textContent = spread.toFixed(2) + ' (' + spreadPct.toFixed(3) + '%)';
    }
    renderStats();
    renderPositions();
    renderEstimates();
  }

  function renderCandles(rows) {
    if (!chartEl) {
      return;
    }
    var width = chartEl.clientWidth || 800;
    var height = chartEl.clientHeight || 400;
    var candles = (rows || []).slice(-60);
    latestCandleRows = candles.slice();
    if (!candles.length) {
      chartEl.innerHTML = '';
      return;
    }

    var lows = candles.map(function (item) { return Number(item.price_low || item.price_close || 0); });
    var highs = candles.map(function (item) { return Number(item.price_high || item.price_close || 0); });
    var volumes = candles.map(function (item) { return Number(item.volume_traded || 0); });
    var prices = [];
    for (var p = 0; p < highs.length; p += 1) {
      prices.push(highs[p], lows[p]);
    }
    var minPriceRaw = Math.min.apply(null, prices);
    var maxPriceRaw = Math.max.apply(null, prices);
    var priceRange = maxPriceRaw - minPriceRaw;
    var paddedRange = priceRange > 0 ? (priceRange * 0.08) : Math.max(1, maxPriceRaw * 0.001);
    var minP = minPriceRaw - paddedRange;
    var maxP = maxPriceRaw + paddedRange;
    var span = Math.max(1e-8, maxP - minP);
    var maxVolume = Math.max.apply(null, volumes.concat([1]));
    var chartTopPad = 8;
    var chartBottomPad = 10;
    var priceAreaH = (height - chartTopPad - chartBottomPad) * 0.82;
    var volAreaH = (height - chartTopPad - chartBottomPad) * 0.18;
    var volumeBaseY = chartTopPad + priceAreaH + volAreaH;
    var candleW = width / Math.max(candles.length, 1);

    function yPos(price) {
      return chartTopPad + priceAreaH - ((price - minP) / span) * priceAreaH;
    }

    var html = '';
    html += '<defs><linearGradient id="gloss-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#33f7b4"/><stop offset="100%" stop-color="#0ecb81"/></linearGradient><linearGradient id="gloss-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ff8d9d"/><stop offset="100%" stop-color="#f6465d"/></linearGradient></defs>';
    for (var g = 0; g <= 4; g += 1) {
      var t = g / 4;
      var gy = chartTopPad + (t * priceAreaH);
      var gridPrice = maxP - (span * t);
      html += '<line x1="0" y1="' + gy.toFixed(2) + '" x2="' + width + '" y2="' + gy.toFixed(2) + '" stroke="rgba(255,255,255,0.04)" />';
      html += '<text x="' + (width - 4) + '" y="' + (gy - 2).toFixed(2) + '" text-anchor="end" fill="var(--text-secondary)" font-size="10">' + formatUsd(gridPrice) + '</text>';
    }

    for (var i = 0; i < candles.length; i += 1) {
      var row = candles[i];
      var close = Number(row.price_close || 0);
      var prevClose = i > 0 ? Number(candles[i - 1].price_close || close) : close;
      var open = Number(row.price_open || prevClose || close);
      close = Number(row.price_close || open || 0);
      var high = Number(row.price_high || Math.max(open, close));
      var low = Number(row.price_low || Math.min(open, close));
      var volume = Number(row.volume_traded || 0);
      var x = i * candleW + 1;
      var center = x + (candleW * 0.5);
      var color = close >= open ? '#0ecb81' : '#f6465d';
      var fillId = close >= open ? 'url(#gloss-green)' : 'url(#gloss-red)';
      var bodyW = Math.max(3, Math.min(12, candleW * 0.58));
      var bodyX = center - (bodyW * 0.5);
      var yOpen = yPos(open);
      var yClose = yPos(close);
      var wickTop = yPos(high);
      var wickBottom = yPos(low);
      if (Math.abs(wickBottom - wickTop) < 1) {
        wickTop -= 0.5;
        wickBottom += 0.5;
      }
      var bodyH = Math.max(Math.abs(yClose - yOpen), 2);
      var bodyTop = ((yOpen + yClose) * 0.5) - (bodyH * 0.5);
      html += '<line x1="' + center + '" y1="' + wickTop + '" x2="' + center + '" y2="' + wickBottom + '" stroke="' + color + '" stroke-width="1" />';
      html += '<rect x="' + bodyX + '" y="' + bodyTop + '" width="' + bodyW + '" height="' + bodyH + '" fill="' + fillId + '" />';
      var volH = (volume / maxVolume) * volAreaH;
      html += '<rect x="' + (x + 1) + '" y="' + (volumeBaseY - volH) + '" width="' + Math.max(1, candleW - 3) + '" height="' + Math.max(1, volH) + '" fill="' + color + '" opacity="0.35" />';
    }

    if (chartHover.active) {
      var hoverX = Math.max(0, Math.min(width, chartHover.x));
      var hoverY = Math.max(chartTopPad, Math.min(chartTopPad + priceAreaH, chartHover.y));
      var hoverIdx = Math.max(0, Math.min(candles.length - 1, Math.floor((hoverX / width) * candles.length)));
      var hoverCenter = (hoverIdx * candleW) + (candleW * 0.5);
      var hoverPrice = maxP - (((hoverY - chartTopPad) / priceAreaH) * span);
      var hoverCandle = candles[hoverIdx];
      var hOpen = Number(hoverCandle.price_open || hoverCandle.price_close || 0);
      var hHigh = Number(hoverCandle.price_high || hOpen);
      var hLow = Number(hoverCandle.price_low || hOpen);
      var hClose = Number(hoverCandle.price_close || hOpen);

      html += '<line x1="' + hoverCenter + '" y1="' + chartTopPad + '" x2="' + hoverCenter + '" y2="' + (chartTopPad + priceAreaH) + '" stroke="rgba(255,255,255,0.22)" stroke-dasharray="3 3" />';
      html += '<line x1="0" y1="' + hoverY + '" x2="' + width + '" y2="' + hoverY + '" stroke="rgba(255,255,255,0.22)" stroke-dasharray="3 3" />';
      html += '<rect x="' + (width - 86) + '" y="' + (hoverY - 8) + '" width="84" height="14" rx="2" fill="#151a20" />';
      html += '<text x="' + (width - 4) + '" y="' + (hoverY + 2) + '" text-anchor="end" fill="#d5dbe3" font-size="10">' + formatUsd(hoverPrice) + '</text>';
      html += '<rect x="6" y="6" width="250" height="14" rx="2" fill="rgba(14,18,22,0.92)" />';
      html += '<text x="10" y="16" fill="#9fb0c3" font-size="10">O ' + formatUsd(hOpen) + '  H ' + formatUsd(hHigh) + '  L ' + formatUsd(hLow) + '  C ' + formatUsd(hClose) + '</text>';
    }

    html += '<line x1="0" y1="' + yPos(markPrice) + '" x2="' + width + '" y2="' + yPos(markPrice) + '" stroke="#9b51e0" stroke-dasharray="4" />';
    html += '<text x="' + (width - 4) + '" y="' + (yPos(markPrice) - 6) + '" text-anchor="end" fill="#9b51e0" font-size="10">Mark ' + formatUsd(markPrice) + '</text>';
    chartEl.innerHTML = html;
  }

  function getPositionPnl(position) {
    var side = position.side;
    var entry = Number(position.entryPrice || 0);
    var size = Number(position.size || 0);
    if (!entry || !size) {
      return { pnl: 0, roe: 0 };
    }
    var delta = side === 'LONG' ? (markPrice - entry) : (entry - markPrice);
    var pnl = delta * size;
    var margin = Number(position.margin || 0);
    var roe = margin > 0 ? (pnl / margin) * 100 : 0;
    return { pnl: pnl, roe: roe };
  }

  function renderPositions() {
    if (!positionsBodyEl || !posCountEl) {
      return;
    }
    if (!futuresState.length) {
      posCountEl.textContent = '0';
      positionsBodyEl.innerHTML = '<tr><td colspan="6" class="empty-row">No open futures positions.</td></tr>';
      return;
    }

    posCountEl.textContent = String(futuresState.length);
    positionsBodyEl.innerHTML = futuresState.map(function (position, idx) {
      var calc = getPositionPnl(position);
      var cls = calc.pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
      return (
        '<tr>' +
          '<td><b>' + position.symbol + '</b><br><span class="' + cls + '">' + position.side + ' ' + position.leverage + 'x</span></td>' +
          '<td>' + Number(position.size || 0).toFixed(6) + '</td>' +
          '<td>' + formatUsd(position.entryPrice) + '</td>' +
          '<td>' + formatUsd(markPrice) + '</td>' +
          '<td class="' + cls + '">' + (calc.pnl >= 0 ? '+' : '-') + formatUsd(Math.abs(calc.pnl)) + '<br><span>(' + formatPct(calc.roe) + ')</span></td>' +
          '<td><button class="btn-close" data-index="' + idx + '" type="button">Close</button></td>' +
        '</tr>'
      );
    }).join('');
  }

  function openPosition(side) {
    var size = Number(sizeInput && sizeInput.value ? sizeInput.value : 0);
    var entry = Number(priceInput && priceInput.value ? priceInput.value : markPrice);
    var tp = Number(document.getElementById('tp-input') && document.getElementById('tp-input').value ? document.getElementById('tp-input').value : 0);
    var sl = Number(document.getElementById('sl-input') && document.getElementById('sl-input').value ? document.getElementById('sl-input').value : 0);

    if (!size || size <= 0) {
      setFeedback('Enter a valid size.', 'error');
      return;
    }

    var notional = size * entry;
    var margin = notional / DEFAULT_LEVERAGE;
    var fee = notional * 0.0004;
    var required = margin + fee;
    if (required > portfolio.cashUsd) {
      setFeedback('Not enough USDT for required margin + fee.', 'error');
      return;
    }

    portfolio.cashUsd -= required;
    futuresState.push({
      symbol: currentPair,
      base: currentBase,
      side: side,
      size: size,
      entryPrice: entry,
      leverage: DEFAULT_LEVERAGE,
      margin: margin,
      fee: fee,
      tp: tp > 0 ? tp : null,
      sl: sl > 0 ? sl : null,
      openedAt: new Date().toISOString(),
    });
    writePortfolio();
    writeFutures();
    renderWallet();
    renderPositions();
    renderEstimates();
    sizeInput.value = '';
    setFeedback(side + ' position opened (wallet updated).', 'success');
  }

  function closePosition(index) {
    if (index < 0 || index >= futuresState.length) {
      return;
    }
    var position = futuresState[index];
    var calc = getPositionPnl(position);
    portfolio.cashUsd += Number(position.margin || 0) + calc.pnl;
    portfolio.todaysPnl = Number(portfolio.todaysPnl || 0) + calc.pnl;
    futuresState.splice(index, 1);
    writePortfolio();
    writeFutures();
    renderWallet();
    renderPositions();
    setFeedback('Position closed and PnL settled to wallet.', 'success');
  }

  function setSizeByPct(pct) {
    var price = Number(priceInput && priceInput.value ? priceInput.value : markPrice);
    if (!price || price <= 0) {
      return;
    }
    var maxNotional = portfolio.cashUsd * DEFAULT_LEVERAGE;
    var size = (maxNotional * pct) / price;
    if (sizeInput) {
      sizeInput.value = size > 0 ? size.toFixed(6) : '';
    }
    renderEstimates();
  }

  function setPair(symbol) {
    currentPair = symbol;
    currentBase = symbol.replace('USDT', '');
    if (sizeUnitEl) {
      sizeUnitEl.textContent = currentBase;
    }
    fetchMarketNow();
  }

  async function fetchTickers() {
    try {
      var response = await fetch('/api/market/tickers/');
      var payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'tickers unavailable');
      }
      var rows = payload.rows || [];

      var options = rows.slice(0, 30).map(function (item) {
        return '<option value="' + item.symbol + '">' + item.symbol + '</option>';
      }).join('');
      if (pairSelect) {
        pairSelect.innerHTML = options;
        pairSelect.value = currentPair;
      }

      var tickerHtml = rows.slice(0, 18).map(function (item) {
        var cls = Number(item.priceChangePercent || 0) >= 0 ? 'up' : 'down';
        var sign = Number(item.priceChangePercent || 0) >= 0 ? '+' : '';
        return '<span class="ticker-item">' + item.symbol + ' ' + formatUsd(item.lastPrice) + ' <span class="' + cls + '">' + sign + Number(item.priceChangePercent || 0).toFixed(2) + '%</span></span>';
      }).join('');
      if (marqueeEl) {
        marqueeEl.innerHTML = tickerHtml;
      }
      if (marqueeCloneEl) {
        marqueeCloneEl.innerHTML = tickerHtml;
      }

      var data = rows.find(function (item) { return item.symbol === currentPair; });
      if (data) {
        price24hChange = parseFloat(data.P || 0);
        markPrice = Number(data.lastPrice || markPrice);
        high24h = parseFloat(data.h || 0);
        low24h = parseFloat(data.l || 0);
        volume24h = parseFloat(data.v || 0).toFixed(3);
        renderStats();
        if (change24hEl) {
          change24hEl.textContent = (data.P || '0') + '%';
        }
      }
    } catch (error) {
      console.error(error);
      setFeedback('Ticker feed unavailable.', 'error');
    }
  }

  async function fetchDepth() {
    try {
      var response = await fetch('/api/market/depth/?base=' + encodeURIComponent(currentBase) + '&quote=USDT&limit=30');
      var payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'depth unavailable');
      }
      renderOrderBook(payload);
    } catch (error) {
      console.error(error);
      setFeedback('Order book unavailable.', 'error');
    }
  }

  async function fetchCandles() {
    try {
      var response = await fetch('/api/market/ohlcv/?base=' + encodeURIComponent(currentBase) + '&quote=USDT&period_id=1MIN&limit=' + String(candleLimit));
      var payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'ohlcv unavailable');
      }
      var rows = payload.rows || [];
      if (!rows.length) {
        return;
      }
      var last = rows[rows.length - 1];
      markPrice = Number(last.price_close || markPrice);
      renderStats();
      renderCandles(rows);
      renderPositions();
      renderEstimates();
    } catch (error) {
      console.error(error);
      setFeedback('Chart feed unavailable.', 'error');
    }
  }

  function fetchMarketNow() {
    renderStats();
    fetchTickers();
    fetchDepth();
    fetchCandles();
  }

  function startCountdown() {
    var seconds = 15125;
    setInterval(function () {
      seconds -= 1;
      if (seconds < 0) {
        seconds = 8 * 3600;
      }
      var h = String(Math.floor(seconds / 3600)).padStart(2, '0');
      var m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
      var s = String(seconds % 60).padStart(2, '0');
      if (countdownEl) {
        countdownEl.textContent = h + ':' + m + ':' + s;
      }
    }, 1000);
  }

  document.querySelectorAll('.pill-toggle .pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      var group = pill.parentElement.querySelectorAll('.pill');
      group.forEach(function (node) {
        node.classList.remove('active');
      });
      pill.classList.add('active');
    });
  });

  document.querySelectorAll('.pct-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setSizeByPct(Number(btn.getAttribute('data-pct') || 0));
    });
  });

  document.querySelectorAll('.tf-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tf-btn').forEach(function (node) { node.classList.remove('active'); });
      btn.classList.add('active');
      candleLimit = Number(btn.getAttribute('data-limit') || 90);
      fetchCandles();
    });
  });

  if (pairSelect) {
    pairSelect.addEventListener('change', function () {
      setPair(pairSelect.value || 'BTCUSDT');
    });
  }

  if (tpslToggleEl && tpslInputsEl) {
    tpslToggleEl.addEventListener('click', function () {
      var isVisible = tpslInputsEl.style.display === 'block';
      tpslInputsEl.style.display = isVisible ? 'none' : 'block';
      tpslToggleEl.className = isVisible ? 'fas fa-eye' : 'fas fa-eye-slash';
    });
  }

  if (buyBtn) {
    buyBtn.addEventListener('click', function () {
      openPosition('LONG');
    });
  }
  if (sellBtn) {
    sellBtn.addEventListener('click', function () {
      openPosition('SHORT');
    });
  }
  if (positionsBodyEl) {
    positionsBodyEl.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.classList.contains('btn-close')) {
        closePosition(Number(target.getAttribute('data-index') || -1));
      }
    });
  }
  if (priceInput) {
    priceInput.addEventListener('input', renderEstimates);
  }
  if (sizeInput) {
    sizeInput.addEventListener('input', renderEstimates);
  }
  if (chartEl) {
    chartEl.addEventListener('mousemove', function (event) {
      var rect = chartEl.getBoundingClientRect();
      chartHover.active = true;
      chartHover.x = event.clientX - rect.left;
      chartHover.y = event.clientY - rect.top;
      if (latestCandleRows.length) {
        renderCandles(latestCandleRows);
      }
    });
    chartEl.addEventListener('mouseleave', function () {
      chartHover.active = false;
      if (latestCandleRows.length) {
        renderCandles(latestCandleRows);
      }
    });
  }

  renderWallet();
  renderStats();
  renderPositions();
  renderEstimates();
  startCountdown();
  fetchMarketNow();

  setInterval(fetchTickers, 25000);
  setInterval(fetchDepth, 3500);
  setInterval(fetchCandles, 60000);
});
