# Providing BSL recordings for evaluation

The development container cannot download BSL video: `media.signbsl.com` (Cloudflare) returns **HTTP 403** to
direct requests, and BSL SignBank forbids scraping. This guide is for running the evaluation on your own machine,
where the dataset's official download path normally works. Nothing here is committed: videos stay in git-ignored
`evaluation/videos/`.

## Option A (recommended): BSLDict, the frozen cohorts

**Dataset:** BSLDict — Momeni, Varol, Albanie, Afouras, Zisserman, *Watch, read and lookup*, ACCV 2020.
Project page <https://www.robots.ox.ac.uk/~vgg/research/bsldict/> · code <https://github.com/gulvarol/bsldict>.

**Licence:** BSLDict metadata is CC BY 4.0
(<https://www.robots.ox.ac.uk/~vgg/research/bsldict/license.txt>). The videos are hosted by their original
owners (signbsl.com contributors), who keep copyright. Use them for evaluation only, don't redistribute or commit
them, and cite the paper. YouTube-hosted entries are excluded from our cohorts.

**What gets used:** 720 clips listed in two manifests that were frozen before any BSL result was produced:

| Manifest | Sources (signer proxy) | Supported (exact BSL-1K label) | Unsupported BSL signs |
| --- | --- | ---: | ---: |
| `docs/bsl-sprint-2026-11-24/bsl-development.json` | SignStation | 300 (300 labels, 16 showcase labels) | 60 |
| `docs/bsl-sprint-2026-11-24/bsl-evaluation.json` | Karl O'Keeffe, Nathanael Farley, Univ. of Wolverhampton, Deafax, Scottish Sensory Centre, Exeter Deaf Academy, others | 300 (283 labels, 17 showcase labels) | 60 |

**Required filenames and layout** (the BSLDict `name` field, unchanged):

```
evaluation/videos/bsldict/
  p_008_064_000_please.mp4
  s_013_026_000_sorry.mp4
  ...                      # every "file" listed in the two manifests
```

**Steps**

1. Download the metadata (148 MB):

```bash
mkdir -p evaluation/raw/bsldict
```

```bash
curl -L -o evaluation/raw/bsldict/bsldict_v1.pkl https://www.robots.ox.ac.uk/~vgg/research/bsldict/data/bsldict_v1.pkl
```

2. Fetch only the listed clips from their `source` URLs. The script verifies hosts, writes into `evaluation/videos/bsldict/`
   and records SHA-256 fingerprints in the manifest:

```bash
npm run eval:bsl:fetch -- docs/bsl-sprint-2026-11-24/bsl-development.json
```

```bash
npm run eval:bsl:fetch -- docs/bsl-sprint-2026-11-24/bsl-evaluation.json
```

   If your network also gets 403s from the script, download the same files with BSLDict's own
   `bsldict/download_videos.py` (or a browser) into `evaluation/videos/bsldict/` under the names above, then rerun the
   two commands. They fingerprint existing files without downloading. Missing clips are recorded as `unavailable` and
   excluded; never substitute other videos.

3. Build and run the development comparison:

```bash
npm ci && npm run build:firebase && node scripts/prepare-recognition-lab.mjs
```

```bash
npm run eval:bsl -- docs/bsl-sprint-2026-11-24/bsl-development.json
```

4. Run the evaluation cohort **once**, after any tuning on development data is finished:

```bash
npm run eval:bsl -- docs/bsl-sprint-2026-11-24/bsl-evaluation.json
```

Each run prints the comparison table (baseline `main`, candidate v2 in the browser, and legacy vs v2 on identical
observations) and writes raw derived results under `evaluation/raw/bsl-runs/`. To share results, commit the
manifests (they now hold fingerprints) and the `summary.json` / result JSON files. They contain labels, scores and
counters only — no video or landmarks.

## Option B: your own consented recordings

Use this for the showcase vocabulary and for **non-sign movement** (BSLDict has none).

- One sign per file: hands at rest ~1 s → sign → hands still ~1 s. MP4/WebM, ≤ 30 s, ≤ 100 MB. Upper body, both shoulders and
  elbows in view.
- Written consent from each signer for evaluation use; pseudonymous IDs only.
- Put the files in `evaluation/videos/own/` and write a manifest in the same format as `foreign-controls.json`:

```json
{ "trials": [
  { "trial_id": "own-s01-hello-1", "category": "supported", "expected_gloss": "HELLO", "signer_id": "s01",
    "cohort": "development", "file": "evaluation/videos/own/s01-hello-1.mp4", "recording_sha256": "<sha256sum>",
    "source": "local consent record C-001", "license": "consented evaluation use", "tags": ["showcase"] },
  { "trial_id": "own-s01-scratch-1", "category": "non_sign", "expected_gloss": null, "signer_id": "s01",
    "cohort": "development", "file": "evaluation/videos/own/s01-scratch-1.mp4", "recording_sha256": "<sha256sum>",
    "source": "local consent record C-001", "license": "consented evaluation use", "tags": [] }
] }
```

  `expected_gloss` must be an exact label from `public/models/bsl1064-pose2sign/labels.json`. Then:

```bash
npm run eval:bsl -- path/to/your-manifest.json
```
