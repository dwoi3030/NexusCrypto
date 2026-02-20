document.addEventListener('DOMContentLoaded', function () {
  const form = document.querySelector('.form-box form');
  if (!form) return;

  function isValidEmail(val) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  }

  form.addEventListener('submit', function (e) {
    const emailInput = form.querySelector('input[name="email"]');
    const passwordInput = form.querySelector('input[name="password"]');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!email || !password) {
      e.preventDefault();
      alert('Please enter both email and password.');
      if (!email && emailInput) {
        emailInput.focus();
      } else if (passwordInput) {
        passwordInput.focus();
      }
      return;
    }

    if (!isValidEmail(email)) {
      e.preventDefault();
      alert('Please enter a valid email address.');
      if (emailInput) emailInput.focus();
    }
  });
});

