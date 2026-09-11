# Security

The deployed Firebase site is a static export. Camera processing, transcripts and personal sign examples run or remain in the visitor’s browser. It has no user accounts, admin endpoints, password store or cloud database.

Never commit credentials, upload environment files to Hosting, or add private tokens to public browser configuration. Build with `npm run build:firebase`; the export step generates script hashes for the Content Security Policy. Deploy only `out/` through the checked-in Firebase configuration.

Run `npm test`, `npm run lint`, `npm run build:firebase` and `npm run audit:security` before deployment. The dependency audit covers published advisories; the pattern-based secret scanner covers fetched Git history and working files, not every possible secret format.

If you find a suspected vulnerability, use the repository’s private vulnerability reporting option if enabled. Otherwise contact the repository owner privately through an established channel; do not publish credentials or exploit details in public issues. If a real credential is exposed, revoke/rotate it with its issuer first. Deleting it from the current source does not invalidate it.

See [the dated audit](docs/SECURITY-AUDIT-2026-09-11.md) for the tested scope and remaining owner checks.
