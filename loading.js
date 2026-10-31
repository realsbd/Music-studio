const screen = document.getElementById('loading-screen');
const bar = document.getElementById('loading-bar');
const progress = document.getElementById('loading-bar-wrap');
const percent = document.getElementById('loading-percent');
const status = document.getElementById('loading-status');
const enter = document.getElementById('loading-enter');
const retry = document.getElementById('loading-retry');
let hideTimer = null;

retry.addEventListener('click', () => window.location.reload());
enter.addEventListener('click', () => {
  screen.classList.add('fade-out');
  enter.disabled = true;
  window.dispatchEvent(new CustomEvent('studio:entered'));
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    screen.style.display = 'none';
    enter.disabled = false;
  }, 420);
});

export function updateLoading(value, message) {
  const amount = Math.round(Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)));
  bar.style.transform = `scaleX(${amount / 100})`;
  progress.setAttribute('aria-valuenow', String(amount));
  percent.textContent = `${amount}%`;
  if (status.textContent !== message) status.textContent = message;
}

export function showLoadError(error) {
  console.error('Studio loading failed:', error);
  clearTimeout(hideTimer);
  screen.dataset.state = 'error';
  screen.classList.remove('fade-out');
  screen.style.display = '';
  progress.hidden = true;
  percent.hidden = true;
  enter.hidden = true;
  status.textContent = /webgl/i.test(error?.message || '')
    ? 'Your browser couldn’t start the 3D view. Try another browser or enable graphics acceleration.'
    : 'The studio couldn’t open. Please try again in a moment.';
  retry.hidden = false;
}

export function showEnterPage() {
  clearTimeout(hideTimer);
  screen.dataset.state = 'ready';
  screen.style.display = '';
  screen.classList.remove('fade-out');
  progress.hidden = true;
  percent.hidden = true;
  retry.hidden = true;
  enter.hidden = false;
  enter.disabled = false;
  status.textContent = 'Studio ready.';
  requestAnimationFrame(() => enter.focus({ preventScroll: true }));
}

export function finishLoading() {
  updateLoading(100, 'Ready');
  showEnterPage();
}
