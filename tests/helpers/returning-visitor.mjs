// Browser smokes that test the camera, transcript or recognition act as a
// returning visitor who has already seen the first-run tour, so "Start
// signing" opens the camera as it does for them. The first-visit tour itself
// is covered by tests/onboarding-smoke.mjs. Install with
// Page.addScriptToEvaluateOnNewDocument before the first navigation.
export const RETURNING_VISITOR = `(() => { try {
  if (!localStorage.getItem('signrelay.onboarding.v1')) localStorage.setItem('signrelay.onboarding.v1', JSON.stringify({ status: 'dismissed', at: Date.now() }));
} catch { /* Storage blocked: the tour is not shown either. */ } })();`;
