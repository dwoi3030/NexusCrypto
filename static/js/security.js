document.addEventListener("DOMContentLoaded", () => {
    const startButton = document.getElementById("startVerificationBtn");
    if (!startButton) {
        return;
    }

    startButton.addEventListener("click", () => {
        startButton.textContent = "Verification Requested";
        startButton.disabled = true;
        startButton.style.opacity = "0.75";
        startButton.style.cursor = "not-allowed";
    });
});
