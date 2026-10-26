// CDP Network settings are scoped to a target. Pause each worker before
// its first script so model fetches cannot escape observation or fault policy.
export async function observeWorkerNetwork(browser) {
  const sessions = new Set(), failures = [];
  let blocked = [], cacheDisabled = false;
  const attached = async ({ sessionId }) => {
    sessions.add(sessionId);
    try {
      await browser.send("Runtime.enable", {}, sessionId);
      await browser.send("Network.enable", {}, sessionId);
      await browser.send("Network.setCacheDisabled", { cacheDisabled }, sessionId);
      await browser.send("Network.setBlockedURLs", { urls: blocked }, sessionId);
      // Recognition workers can create another worker for reference matching.
      await browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
    } catch (error) { if (sessions.has(sessionId)) failures.push(String(error)); }
    finally { await browser.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {}); }
  };
  const detach = browser.onEvent(message => {
    if (message.method === "Target.attachedToTarget") void attached(message.params);
    if (message.method === "Target.detachedFromTarget") sessions.delete(message.params.sessionId);
  });
  await browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const all = async (method, params) => {
    await browser.send(method, params);
    await Promise.all([...sessions].map(async sessionId => {
      try { await browser.send(method, params, sessionId); }
      catch (error) { if (sessions.has(sessionId)) throw error; }
    }));
  };
  return {
    failures, sessions,
    async block(urls) { blocked = urls; await all("Network.setBlockedURLs", { urls }); },
    async disableCache(value) { cacheDisabled = value; await all("Network.setCacheDisabled", { cacheDisabled }); },
    close: detach,
  };
}
