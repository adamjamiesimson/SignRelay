export class WorkerClient {
  constructor(path, options) {
    this.worker = new Worker(new URL(path, location.href), options);
    this.sequence = 0;
    this.queue = new Map();
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'error') return this.fail(new Error(data.detail));
      const task = this.queue.get(data.id ?? 0);
      if (!task) return;
      clearTimeout(task.timer);
      this.queue.delete(data.id ?? 0);
      task.resolve(data);
    };
    this.worker.onerror = event => this.fail(new Error(event.message || 'Recognition worker stopped.'));
    this.worker.onmessageerror = () => this.fail(new Error('Recognition worker reply could not be read.'));
  }
  request(type, payload = {}, transfers = []) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Worker is closed.'));
      const id = type === 'init' ? 0 : ++this.sequence;
      const timer = setTimeout(() => this.fail(new Error('Recognition worker timed out.')), type === 'init' ? 45000 : 4500);
      this.queue.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ ...payload, type, id }, transfers);
      } catch (error) {
        this.fail(error);
      }
    });
  }
  fail(error) {
    this.closed = true;
    this.worker.terminate();
    for (const task of this.queue.values()) {
      clearTimeout(task.timer);
      task.reject(error);
    }
    this.queue.clear();
  }
  close() { if (!this.closed) this.fail(new Error('Recognition worker closed.')); }
}

export function startWorkers() {
  const tracker = new WorkerClient('./tracker.js');
  const classifier = new WorkerClient('./classifier.mjs', { type: 'module' });
  const ready = Promise.all([tracker.request('init'), classifier.request('init')]);
  return { tracker, classifier, ready, close() { tracker.close(); classifier.close(); } };
}

