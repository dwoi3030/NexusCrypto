document.addEventListener('DOMContentLoaded', function () {
  const cards = document.querySelectorAll('.bank-card');
  const targetBank = document.getElementById('targetBank');
  const modal = document.getElementById('paymentModal');
  const overlay = document.getElementById('overlay');
  const closeIcon = document.getElementById('deposit-close');
  const submitButton = document.getElementById('deposit-submit');

  if (!modal || !overlay || !targetBank) {
    return;
  }

  function openModal(name) {
    targetBank.textContent = name || '';
    modal.classList.add('active');
    overlay.style.display = 'block';
  }

  function closeModal() {
    modal.classList.remove('active');
    overlay.style.display = 'none';
  }

  cards.forEach((card) => {
    const name = card.getAttribute('data-bank') || '';
    card.addEventListener('click', () => openModal(name));
  });

  overlay.addEventListener('click', closeModal);

  if (closeIcon) {
    closeIcon.addEventListener('click', closeModal);
  }

  if (submitButton) {
    submitButton.addEventListener('click', function () {
      // Simple demo behaviour; replace with real deposit flow later.
      alert('Transaction Processing...');
    });
  }
});

