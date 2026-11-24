const workerStatus = worker => new Promise((resolve, reject) => {
  const channel = new MessageChannel();
  const timer = setTimeout(() => {
    channel.port1.close();
    reject(new Error('Offline check timed out.'));
  }, 3000);
  channel.port1.onmessage = ({ data }) => {
    clearTimeout(timer);
    channel.port1.close();
    resolve(data);
  };
  worker.postMessage({ type: 'OFFLINE_STATUS' }, [channel.port2]);
});

export async function checkOffline(wait = false) {
  if (!navigator.serviceWorker) throw new Error('Offline caching requires a secure browser context.');
  const registration = await navigator.serviceWorker.getRegistration('./') ?? await navigator.serviceWorker.register('./sw.js');
  const worker = navigator.serviceWorker.controller ?? registration.active ?? (wait ? (await navigator.serviceWorker.ready).active : null);
  if (!worker) return { installing: true, missing: [] };
  return workerStatus(worker);
}

