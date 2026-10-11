const query = new URLSearchParams(window.location.search);
if (query.get('coordinate-kernel-experiment') === '1') {
  document.title = 'Imported geometry coordinate-kernel experiment';
  document.querySelector('h1').textContent =
    '50,000-coordinate geometry kernel comparison';
  document.querySelector('body > p').textContent =
    'Five alternating fresh-viewer pairs compare Cesium conversion with the opt-in scalar kernel for full 50,000-coordinate line and polygon imports. Load and first-usable timing are reported separately from pixel capture. This is an unprofiled hosted component experiment, not full-application acceptance.';
  document
    .querySelectorAll('body > label, #frame-probe, #download')
    .forEach((control) => {
      control.hidden = true;
    });
  document.querySelector('#run').textContent =
    'Run coordinate-kernel comparison';
  await import('./import-coordinate-kernel-ui.js');
} else await import('./import-batches-ui.js');
