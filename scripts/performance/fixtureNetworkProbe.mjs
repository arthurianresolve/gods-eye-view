import assert from 'node:assert/strict';

/** Prove worker fetches reach the page interceptor, without contacting providers. */
export function createFixtureNetworkProbe(base) {
  const urls = [
    new URL('/__qa_network_probe', base).href,
    'https://fixture-network.invalid/fulfilled',
    'https://fixture-network.invalid/blocked',
  ];
  const observed = new Set();
  const marker = 'fixture-network-intercepted';
  return {
    respond(url) {
      const index = urls.indexOf(url.href);
      if (index < 0) return undefined;
      observed.add(index);
      if (index === 2) return undefined; // Ordinary external-request rejection.
      return {
        status: 200,
        contentType: 'text/plain',
        headers: { 'access-control-allow-origin': '*' },
        body: marker,
      };
    },
    async verify(page) {
      observed.clear();
      const result = await page.evaluate(async (targets) => {
        const source = `onmessage = async ({ data: urls }) => {
          const results = [];
          for (const url of urls) {
            try { results.push(await (await fetch(url)).text()); }
            catch { results.push('blocked'); }
          }
          postMessage(results);
        };`;
        const objectUrl = URL.createObjectURL(
          new Blob([source], { type: 'text/javascript' }),
        );
        let worker, timeout;
        try {
          worker = new Worker(objectUrl, { type: 'module' });
          return await new Promise((resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Fixture worker network probe timed out')),
              10000,
            );
            worker.onmessage = ({ data }) => resolve(data);
            worker.onerror = () =>
              reject(new Error('Fixture network worker failed'));
            worker.postMessage(targets);
          });
        } finally {
          clearTimeout(timeout);
          worker?.terminate();
          URL.revokeObjectURL(objectUrl);
        }
      }, urls);
      assert.deepEqual(result, [marker, marker, 'blocked']);
      // A DNS failure alone is not proof that the fixture intercepted traffic.
      assert.deepEqual([...observed].sort(), [0, 1, 2]);
      return { status: 'passed', interceptedWorkerRequests: observed.size };
    },
  };
}
