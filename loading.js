const screen = document.getElementById('loading-screen');
const bar = document.getElementById('loading-bar');
const progress = document.getElementById('loading-bar-wrap');
const percent = document.getElementById('loading-percent');
const status = document.getElementById('loading-status');
const retry = document.getElementById('loading-retry');

retry.addEventListener('click', () => window.location.reload());

export function updateLoading(value, message) {
  const amount = Math.round(Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)));
  bar.style.transform = `scaleX(${amount / 100})`;
  progress.setAttribute('aria-valuenow', String(amount));
  percent.textContent = `${amount}%`;
  if (status.textContent !== message) status.textContent = message;
}

export function showLoadError(error) {
  console.error('Studio loading failed:', error);
  screen.dataset.state = 'error';
  screen.classList.remove('fade-out');
  screen.style.display = '';
  progress.hidden = true;
  percent.hidden = true;
  status.textContent = /webgl/i.test(error?.message || '')
    ? 'Your browser couldn’t start the 3D view. Try another browser or enable graphics acceleration.'
    : 'The studio couldn’t open. Please try again in a moment.';
  retry.hidden = false;
}

export function finishLoading() {
  updateLoading(100, 'Ready');
  screen.dataset.state = 'ready';
  screen.classList.add('fade-out');
  setTimeout(() => { screen.style.display = 'none'; }, 320);
}
