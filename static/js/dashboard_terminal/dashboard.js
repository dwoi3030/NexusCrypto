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

  var chart = null;
  var chartRows = [];
  var allAssets = [];
  var selectedAsset = {
    symbol: 'BTC',
    name: 'Bitcoin',
    image: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
  };

  var wallet = {
    usdt: 50,
    btc: 0,
    latestPrice: 64321,
  };

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

  function setLivePrice(price) {
    wallet.latestPrice = Number(price);
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

  function setPair(asset) {
    selectedAsset = asset;
    if (pairBase) {
      pairBase.textContent = asset.symbol;
    }
    if (pairName) {
      pairName.textContent = asset.name;
    }
    if (pairLogo) {
      var fallback = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(asset.symbol) + '&background=9b51e0&color=fff';
      pairLogo.src = asset.image || fallback;
      pairLogo.alt = asset.name || asset.symbol;
    }
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
    wallet.btc += amount;
    updateAvailable();
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
    if (amount > wallet.btc) {
      setFeedback('Not enough BTC for this sell.', 'error');
      return;
    }
    var revenue = amount * wallet.latestPrice;
    wallet.btc -= amount;
    wallet.usdt += revenue;
    updateAvailable();
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
<<<<<<< ours
});
=======
});
>>>>>>> theirs
