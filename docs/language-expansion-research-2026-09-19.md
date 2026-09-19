# Ninth/tenth-language research — 19 September 2026

## Goal

Find genuinely open, ungated candidates (no Hugging Face account, no
institutional data-use agreement) for additional sign languages, each with
at least 200 real recognizable words, toward the project's 15-language
target. This continues from the six already-installed languages (ASL, BSL,
RSL, Bangla, LSE, ISL) and the blocked Auslan audit
(`docs/auslan-feasibility-audit-2026-09-19.md`).

## Strongest candidate found: NGT200 (Dutch / Sign Language of the Netherlands)

- **200 isolated signs**, captured from 3 Deaf native signers plus a
  synthetic avatar, at three camera angles.
- **Landmarks extracted with MediaPipe Holistic** (75 landmarks/frame) —
  the same tracker family SignRelay already uses live. This is a real
  structural advantage over Auslan's AlphaPose Halpe-136 data: no
  cross-format conversion problem, in principle.
- **License: CC BY 4.0** for the dataset, **MIT** for the training code.
  Fully open, not even non-commercial-restricted — better terms than most
  of the six languages already installed.
- Paper: "The NGT200 Dataset: Geometric Multi-View Isolated Sign
  Recognition" (Ranum et al., ICML workshop 2024). Code:
  `github.com/OlineRanum/GMVISR` (training code and evaluation scripts
  only — no pretrained checkpoint is published, so a model would need to
  be trained from the released pose data, the same way LSE/Bangla were).
- **Blocked**: the actual pose/video files are hosted on OSF
  (`osf.io/5zuyd`), which this sandbox's network egress policy blocks at
  the organization level (confirmed with a direct `curl` to `osf.io`,
  `files.osf.io`, and the OSF download endpoint — all rejected by the
  proxy with "connect_rejected... organization policy", not a dataset-side
  restriction). This is the identical failure mode as the Auslan/MM-WLAuslan
  audit: a real, clean dataset that this environment cannot reach.

**This is the best next-language lead found.** It clears every constraint in
the brief (no account, no institutional agreement, open licence, compatible
landmark format) except one: this sandbox cannot download it.

## Candidates checked and ruled out

- **AUTSL (Turkish, 226 signs)**: requires a research-use application to
  `cvml.ankara.edu.tr` — a gated request, which the project's own policy
  says to stop at rather than push past.
- **GKSL (Korean, AIRC-KETI, GitHub-hosted)**: cloned directly
  (`github.com/AIRC-KETI/GKSL-dataset`, CC BY-NC-SA 4.0). Turned out to be
  a **text-only gloss-to-sentence corpus** (Korean gloss sequences paired
  with Korean sentences, e.g. `KETI-Emergency` rows), with no video or pose
  data at all. Useful for gloss-to-text translation research, not for
  training an isolated-sign recognizer. Not usable here.
- **Korean 2,946-class Hugging Face model** (`Seoyoung07/korean-sign-word-
  classifier-mediapipe`): already flagged in the 17 September handoff as
  `license: other` with no clear reuse grant. Unchanged; still blocked, and
  Hugging Face itself is unreachable from this sandbox regardless.
- **LSA64 (Argentine, 64 signs)**: CC BY-NC-SA 4.0, genuinely open, but only
  64 classes — well under the 200-word floor. Not enough on its own.
- **GSL isolated (Greek, 347 signs, IRAL lab)**: would clear the 200-word
  bar, but its host (`robotics.ntua.gr`) is blocked by this sandbox's
  egress policy, so its actual access terms (open download vs. request
  form) could not be verified.
- **BISINDO (Indonesian)**: several independent small projects exist
  (32–1,600 signs, mostly alphabet-level or single-region), none reaching
  a coherent 200+-word open corpus with usable pose data.
- **DGS (German)**: PHOENIX14T (1,066 signs) is continuous/translation data
  from broadcast interpreters, not an isolated-sign corpus with per-class
  video; the "Public DGS Corpus" is a large annotated linguistic corpus,
  not license-cleared for redistribution without further checking, and its
  host was not reachable to verify. DGS Kinect is open but only 40 signs.
- **JSL (Japanese)**: the most promising recent corpus (JSL-DC, CC BY 4.0
  planned) is described as "will be released" in its own abstract — not
  confirmed available yet, and its host is unreachable to verify current
  status.
- **BIM-SIGN Pose (Malaysian, MediaPipe Holistic, 117 classes)**: same
  tracker family as NGT200, but only 117 classes (under 200) and hosted on
  Zenodo, which this sandbox also blocks.

## What this confirms

The network-policy wall found during the Auslan audit is not specific to
that one dataset. It blocks the standard hosts the sign-language research
community actually uses to release data: OSF, Zenodo, Hugging Face, arXiv,
university lab sites, and NeurIPS/OpenReview. `github.com` and
`raw.githubusercontent.com` are the only reliably reachable research hosts
from this sandbox. That rules out working within this sandbox alone for
most credible candidates, no matter how clean their licence terms are.

## Recommended next step

NGT200 is worth pursuing specifically because its terms are unusually good
(CC BY 4.0, MediaPipe-native) and it exactly meets the 200-word floor. To
actually use it, one of the following is needed:

1. Access this sandbox's network policy allowlist to add `osf.io` (an
   environment/organization setting, not something resolvable from inside
   the session), or
2. Download `osf.io/5zuyd` from an unblocked machine/browser and provide
   the pose/metadata archive directly (as an upload), or
3. Continue the search for a language with its actual release hosted
   directly on GitHub (the one host proven reachable here), accepting that
   this narrows the field significantly.

No new language should be added to `lib/model-adapters.ts` as
"experimental" until real pose/video data is in hand, trained, exported to
ONNX, and evaluated — the same standard already applied to the six
installed languages.

## Update: PSL installed as the 7th language

The `sign-language-translator/sign-language-datasets` GitHub Releases (the
same host used by GKSL, above) turned out to have a genuinely usable
isolated-sign dictionary after all: **Pakistan Sign Language, 775 signs,
CC BY 4.0, MediaPipe-native landmarks, hosted as a downloadable GitHub
Release asset** rather than gated behind OSF/Zenodo/HuggingFace. Verified
by direct download and cross-checked against the source project's own
`connections.py` landmark-index layout (not assumed). Full detail in
`docs/pretrained-expansion-2026-09-19.md`. This is the first confirmation
that the "host it directly on GitHub" pattern (as opposed to OSF/Zenodo/
university sites, which this sandbox cannot reach) is a real, repeatable
way to find usable candidates, not just true for one lucky dataset.

## Second pass: searching for an 8th/9th/10th language via the same pattern

Re-ran the search specifically for GitHub/GitLab-hosted (not OSF/Zenodo/
university-site-hosted) isolated-sign datasets with 200+ classes:

- **`sign-language-translator` project itself**: checked whether it has
  released dictionaries for any other country beyond Pakistan (the naming
  convention explicitly supports it: `country-organization-groupNumber`).
  Its `asset_urls/archive-urls.json` "re-recordings" list is empty and its
  four release tags (`v0.0.1`-`v0.0.4`) only ever reference `pk-hfad-1`.
  No second country is available there yet.
- **A curated 73-dataset, 26-language catalog**
  (`github.com/rudra496/SignLanguage-Dataset-Hub`, CC BY 4.0 catalog itself)
  was fetched and filtered programmatically for openly-licensed entries not
  already installed. Every genuinely open, sufficiently large candidate it
  lists resolves to a host this sandbox cannot reach (OSF, Zenodo, or a
  university domain); every one hosted on GitHub was either already
  installed (WLASL/ASL, an ISL landmark set) or under 200 classes.
- **Turkish (AUTSL, 226 signs)**: the catalog lists its paper as CC BY 4.0,
  but the actual video data still requires an institutional-use application
  to `cvml.ankara.edu.tr` (unchanged from the first pass) - a paper's
  licence does not carry over to the dataset's access terms.
- **Brazilian (Libras)**: three separate isolated-sign corpora exist
  (UFPR/lesoliveira, MINDS-Libras: 20 signs, LIBRAS-UFOP: 56 signs); the
  larger UFPR one's host (`inf.ufpr.br`) and a fourth candidate
  (`libras.cin.ufpe.br`) are both blocked by this sandbox's network policy,
  and the two reachable ones are far under 200 classes.
- **Filipino, Vietnamese**: only small (24-105 class), often unlicensed
  hobbyist/student projects found; no dataset near 200 classes with a clear
  open licence.

**Conclusion of this pass**: no 8th language cleared every gate this time.
NGT200 (documented above) remains the strongest lead, blocked only by this
sandbox's inability to reach `osf.io`. Continuing to search without a way
to reach OSF/Zenodo/most university hosts has hit real diminishing returns;
the productive next step is resolving that network access, not more
searching from inside this sandbox.
