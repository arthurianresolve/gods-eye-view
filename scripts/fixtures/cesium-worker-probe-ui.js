import { runCesiumWorkerProbe } from './cesium-worker-probe.js';
const button = document.querySelector('#run');
const result = document.querySelector('#result');
button.addEventListener('click', async () => {
  button.disabled = true;
  result.textContent = 'Running';
  try {
    result.textContent = JSON.stringify(await runCesiumWorkerProbe(), null, 2);
  } catch (error) {
    result.textContent = JSON.stringify({
      status: 'failed',
      error: error.message,
    });
  } finally {
    button.disabled = false;
  }
});
