// Shared signer aliases, safe to bundle into the browser evaluation lab.
// Never import Node-only manifest or filesystem code from browser-bound metrics.
export const signerKey = id => id.replace(/^gtsignstudy/, "popsign-").replace(/^popsign-(?:gtsignstudy)?/, "popsign-");
