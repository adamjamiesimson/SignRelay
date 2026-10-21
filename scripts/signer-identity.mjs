// Shared signer aliases, safe to bundle into the browser evaluation lab.
// Never import Node-only manifest or filesystem code from browser-bound metrics.
// Case, Unicode form, surrounding space and space/underscore separators do not
// create a new person; publisher prefixes for one PopSign signer collapse too.
export const signerKey = id => id.normalize("NFKC").trim().toLowerCase().replace(/[\s_]+/g, "-")
  .replace(/^gtsignstudy/, "popsign-").replace(/^popsign-(?:gtsignstudy)?/, "popsign-");
