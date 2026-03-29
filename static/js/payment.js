(function () {
  var Sync = window.NexusPortfolioSync || null;
  var form = document.getElementById('payment-form');
  var submitButton = document.getElementById('submit-button');
  var submitContent = document.getElementById('submit-content');
  var cardInput = document.getElementById('card-number');
  var expiryInput = document.getElementById('expiry');
  var cvcInput = document.getElementById('cvc');
  var cardNameInput = document.getElementById('card-name');
  var emailInput = document.getElementById('email');
  var zipInput = document.getElementById('zip');
  var countryInput = document.getElementById('country');
  var upiInput = document.getElementById('upi-id');
  var cardFields = document.getElementById('card-fields');
  var upiFields = document.getElementById('upi-fields');
  var cardTypeText = document.getElementById('card-type-text');
  var methodBadge = document.getElementById('payment-method-badge');
  var visaIcon = document.getElementById('visa-icon');
  var mcIcon = document.getElementById('mc-icon');

  if (!form || !submitButton || !submitContent) {
    return;
  }

  var selectedMethod = String(form.dataset.method || 'Card').trim();
  var chargedAmount = Number(form.dataset.total || 0);
  var creditedAmount = Number(form.dataset.credit || form.dataset.total || 0);
  var completeUrl = String(form.dataset.completeUrl || '/wallet/payment/complete/').trim();
  var isUpiFlow = /upi|gpay|phonepe|google pay/i.test(selectedMethod);

  function getCardMeta(number) {
    var value = String(number || '').replace(/\D/g, '');
    if (/^4/.test(value)) {
      return { type: 'Visa', cvcLength: 3, lengths: [13, 16, 19], format: '4-4-4-4-3' };
    }
    if (/^(5[1-5]|2[2-7])/.test(value)) {
      return { type: 'Mastercard', cvcLength: 3, lengths: [16], format: '4-4-4-4' };
    }
    if (/^3[47]/.test(value)) {
      return { type: 'American Express', cvcLength: 4, lengths: [15], format: '4-6-5' };
    }
    if (/^6(?:011|5)/.test(value)) {
      return { type: 'Discover', cvcLength: 3, lengths: [16, 19], format: '4-4-4-4-3' };
    }
    return { type: 'Unknown', cvcLength: 3, lengths: [16], format: '4-4-4-4' };
  }

  function formatCardNumber(number, meta) {
    var value = String(number || '').replace(/\D/g, '').slice(0, 19);
    if (meta.type === 'American Express') {
      var part1 = value.slice(0, 4);
      var part2 = value.slice(4, 10);
      var part3 = value.slice(10, 15);
      return [part1, part2, part3].filter(Boolean).join(' ');
    }
    return (value.match(/.{1,4}/g) || []).join(' ');
  }

  function luhnCheck(number) {
    var digits = String(number || '').replace(/\D/g, '');
    if (!digits) {
      return false;
    }
    var sum = 0;
    var shouldDouble = false;
    for (var i = digits.length - 1; i >= 0; i -= 1) {
      var d = Number(digits.charAt(i));
      if (shouldDouble) {
        d *= 2;
        if (d > 9) {
          d -= 9;
        }
      }
      sum += d;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  function detectCardType(number) {
    var meta = getCardMeta(number);
    if (cardTypeText) {
      cardTypeText.textContent = 'Detected card: ' + meta.type;
    }
    if (visaIcon && mcIcon) {
      if (meta.type === 'Visa') {
        visaIcon.style.opacity = '1';
        mcIcon.style.opacity = '0.35';
      } else if (meta.type === 'Mastercard') {
        visaIcon.style.opacity = '0.35';
        mcIcon.style.opacity = '1';
      } else {
        visaIcon.style.opacity = '1';
        mcIcon.style.opacity = '1';
      }
    }
    return meta;
  }

  function setMethodUi() {
    if (methodBadge) {
      methodBadge.textContent = 'Method: ' + selectedMethod;
    }
    if (isUpiFlow) {
      if (cardFields) {
        cardFields.classList.add('hidden');
      }
      if (upiFields) {
        upiFields.classList.remove('hidden');
      }
      if (cardInput) cardInput.required = false;
      if (expiryInput) expiryInput.required = false;
      if (cvcInput) cvcInput.required = false;
      if (cardNameInput) cardNameInput.required = false;
      if (upiInput) upiInput.required = true;
      return;
    }
    if (cardFields) {
      cardFields.classList.remove('hidden');
    }
    if (upiFields) {
      upiFields.classList.add('hidden');
    }
    if (cardInput) cardInput.required = true;
    if (expiryInput) expiryInput.required = true;
    if (cvcInput) cvcInput.required = true;
    if (cardNameInput) cardNameInput.required = true;
    if (upiInput) upiInput.required = false;
  }

  function findErrorAnchor(field) {
    if (!field) {
      return form;
    }
    if (field.closest('.space-y-2')) {
      return field.closest('.space-y-2');
    }
    if (field.parentElement) {
      return field.parentElement;
    }
    return form;
  }

  function clearError(field) {
    if (!field) {
      return;
    }
    field.classList.remove('shake', 'input-error');
    var key = field.id || field.name || 'field';
    var anchor = findErrorAnchor(field);
    var existing = anchor.querySelector('.field-error[data-for="' + key + '"]');
    if (existing) {
      existing.remove();
    }
  }

  function addError(field, message) {
    if (!field) {
      return;
    }
    var key = field.id || field.name || 'field';
    field.classList.add('shake', 'input-error');
    field.addEventListener('animationend', function removeShake() {
      field.classList.remove('shake');
      field.removeEventListener('animationend', removeShake);
    }, { once: true });
    var anchor = findErrorAnchor(field);
    var existing = anchor.querySelector('.field-error[data-for="' + key + '"]');
    if (existing) {
      existing.remove();
    }
    var error = document.createElement('p');
    error.className = 'field-error';
    error.dataset.for = key;
    error.textContent = message || 'Please enter a valid value.';
    anchor.appendChild(error);
  }

  function isValidExpiry(value) {
    var clean = String(value || '').replace(/\s/g, '');
    var parts = clean.split('/');
    if (parts.length !== 2) {
      return false;
    }
    var mm = Number(parts[0]);
    var yy = Number(parts[1]);
    if (!mm || mm < 1 || mm > 12) {
      return false;
    }
    var fullYear = 2000 + yy;
    var now = new Date();
    var expiry = new Date(fullYear, mm, 0, 23, 59, 59, 999);
    return expiry.getTime() >= now.getTime();
  }

  function validateEmail() {
    var value = String(emailInput && emailInput.value || '').trim();
    if (!value) {
      addError(emailInput, 'Email is required.');
      return false;
    }
    var ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (!ok) {
      addError(emailInput, 'Enter a valid email address.');
      return false;
    }
    return true;
  }

  function validateCardFlow() {
    var ok = true;
    var cardNumber = String(cardInput && cardInput.value || '').replace(/\D/g, '');
    var meta = detectCardType(cardNumber);

    if (!cardNumber) {
      addError(cardInput, 'Card number is required.');
      ok = false;
    } else if (meta.lengths.indexOf(cardNumber.length) === -1 || !luhnCheck(cardNumber)) {
      addError(cardInput, 'Enter a valid ' + meta.type + ' card number.');
      ok = false;
    }

    var expiry = String(expiryInput && expiryInput.value || '').trim();
    if (!expiry) {
      addError(expiryInput, 'Expiry date is required.');
      ok = false;
    } else if (!isValidExpiry(expiry)) {
      addError(expiryInput, 'Card expiry is invalid or expired.');
      ok = false;
    }

    var cvc = String(cvcInput && cvcInput.value || '').trim();
    if (!cvc) {
      addError(cvcInput, 'Security code is required.');
      ok = false;
    } else if (!new RegExp('^\\d{' + meta.cvcLength + '}$').test(cvc)) {
      addError(cvcInput, 'Security code should be ' + meta.cvcLength + ' digits.');
      ok = false;
    }

    var cardName = String(cardNameInput && cardNameInput.value || '').trim();
    if (!cardName) {
      addError(cardNameInput, 'Cardholder name is required.');
      ok = false;
    }
    return ok;
  }

  function validateUpiFlow() {
    var upi = String(upiInput && upiInput.value || '').trim();
    if (!upi) {
      addError(upiInput, 'UPI ID is required.');
      return false;
    }
    var ok = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/.test(upi);
    if (!ok) {
      addError(upiInput, 'Enter a valid UPI ID (for example: alex@oksbi).');
      return false;
    }
    return true;
  }

  function validateCommonFields() {
    var ok = true;
    if (!validateEmail()) {
      ok = false;
    }
    if (!String(zipInput && zipInput.value || '').trim()) {
      addError(zipInput, 'ZIP / Postal code is required.');
      ok = false;
    }
    if (!String(countryInput && countryInput.value || '').trim()) {
      addError(countryInput, 'Country is required.');
      ok = false;
    }
    return ok;
  }

  function clearAllErrors() {
    [emailInput, cardInput, expiryInput, cvcInput, cardNameInput, countryInput, zipInput, upiInput].forEach(clearError);
  }

  function getCsrfToken() {
    var match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function completePaymentOnBackend() {
    var response = await fetch(completeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken(),
      },
      body: JSON.stringify({
        amount: Number(creditedAmount || 0),
        charged_total: Number(chargedAmount || 0),
        method: selectedMethod,
      }),
    });
    var payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload && payload.error ? payload.error : 'Payment completion failed.');
    }
    return payload;
  }

  function syncWalletAfterSuccess(payload) {
    if (!Sync) {
      return;
    }
    var state = Sync.readPortfolio();
    var backendBalance = Number(payload && payload.wallet_balance || 0);
    var credited = Number(creditedAmount || 0);
    if (Number.isFinite(backendBalance) && backendBalance >= 0) {
      state.cashUsd = backendBalance;
    } else {
      state.cashUsd = Number(state.cashUsd || 0) + credited;
    }
    Sync.writePortfolio(state, { source: 'payment_gateway' });
    Sync.recordTrade({
      type: 'Deposit',
      side: 'Credit',
      pair: 'USD/USDT',
      asset: 'USDT',
      amount: credited,
      amountText: '+' + credited.toFixed(2) + ' USDT',
      price: 1,
      fee: 0,
      total: credited,
      note: 'Wallet deposit via ' + selectedMethod,
      source: 'payment_gateway',
    });
  }

  if (cardInput) {
    cardInput.addEventListener('input', function (e) {
      var meta = getCardMeta(e.target.value);
      e.target.value = formatCardNumber(e.target.value, meta);
      detectCardType(e.target.value);
      clearError(cardInput);
    });
  }

  if (expiryInput) {
    expiryInput.addEventListener('input', function (e) {
      var value = e.target.value.replace(/\D/g, '').substring(0, 4);
      if (value.length >= 3) {
        value = value.substring(0, 2) + ' / ' + value.substring(2);
      }
      e.target.value = value;
      clearError(expiryInput);
    });
  }

  if (cvcInput) {
    cvcInput.addEventListener('input', function (e) {
      e.target.value = e.target.value.replace(/\D/g, '').substring(0, 4);
      clearError(cvcInput);
    });
  }

  [emailInput, cardNameInput, countryInput, zipInput, upiInput].forEach(function (field) {
    if (!field) {
      return;
    }
    field.addEventListener('input', function () {
      clearError(field);
    });
  });

  setMethodUi();
  detectCardType(cardInput ? cardInput.value : '');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearAllErrors();

    var valid = validateCommonFields();
    if (isUpiFlow) {
      valid = validateUpiFlow() && valid;
    } else {
      valid = validateCardFlow() && valid;
    }

    if (!valid) {
      return;
    }

    submitButton.disabled = true;
    submitContent.innerHTML = '<span class="spinner"></span><span>Processing secure payment...</span>';

    window.setTimeout(async function () {
      try {
        var payload = await completePaymentOnBackend();
        syncWalletAfterSuccess(payload);
        submitContent.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256" class="text-emerald-300"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"></path></svg><span>Payment Successful (Demo)</span>';
        submitButton.classList.remove('from-purple-600', 'to-indigo-600');
        submitButton.classList.add('from-emerald-600', 'to-emerald-500');
      } catch (error) {
        submitButton.disabled = false;
        submitContent.innerHTML = '<span>Complete Secure Payment</span>';
        addError(isUpiFlow ? upiInput : cardInput, String(error && error.message ? error.message : 'Payment failed. Please try again.'));
      }
    }, 900);
  });
})();
