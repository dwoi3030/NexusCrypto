document.addEventListener('DOMContentLoaded', function () {
  // Simple active state handling for sidebar buttons
  const sideButtons = document.querySelectorAll('.side-btn');
  sideButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      sideButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
});

