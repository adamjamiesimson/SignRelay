# Auslan (MM-WLAuslan) feasibility audit — 19 September 2026

## Context

This continues the language-7 (Auslan) research direction from the 17 September
handoff (`docs/pretrained-expansion-2026-09-17.md`), which lists Auslan as
"Model preparing" with no automatic recognition output installed. An earlier
research brief for this task described a completed MM-WLAuslan pilot (dataset
intake, a 400-class GRU checkpoint, ONNX export, WASM benchmarks) with
artifacts at `/home/ubuntu/work/auslan/pilot-model/`. That path, and every
script and document it references (`training/*auslan*`,
`docs/auslan-browser-readiness-2026-09-19.md`,
`docs/large-language-model-audit-2026-09-18.md`), **does not exist anywhere in
this repository's git history**, on any branch. It was evidently produced in
an ephemeral sandbox from a prior session and never committed. It cannot be
recovered or continued from here, and nothing described in it should be
treated as installed or verified.

This document is a fresh feasibility check for the task's stated first step:
auditing licence/access terms for the MM-WLAuslan RGB/depth videos needed to
extract MediaPipe-native landmarks (the project's own dataset-to-browser
pipeline requires raw video, not the dataset's native AlphaPose Halpe-136
pose files, because SignRelay's browser tracker is MediaPipe, not AlphaPose).

## Result: audit could not be completed — network policy blocker

This sandbox's outbound network egress policy blocks every domain that could
plausibly host the dataset's actual access/download instructions:

- `arxiv.org` and `ar5iv.labs.arxiv.org` (the MM-WLAuslan paper, arXiv 2410.19488)
- `huggingface.co`
- `openreview.net` and `papers.nips.cc` (NeurIPS 2024 Datasets & Benchmarks track)
- `paperswithcode.com`
- `cdn.jsdelivr.net` (raw GitHub file mirror)
- `uq-cvlab.github.io` (the dataset's own project page — the most likely home
  for a request form or download links)

Only `github.com` itself and web search summaries were reachable. The one
GitHub repository found for the project, `UQ-CVLab/MM-WLAuslan-Dataset`, is an
**unmodified Jekyll "TeXt" theme template fork** — it still contains the
theme's placeholder 2018 blog posts ("welcome", "header-image") and a mostly
empty `about.md`. It is scaffolding for the blocked GitHub Pages site, not a
dataset host, and contains no access instructions.

This is a network-policy limitation of this specific sandboxed session, not a
finding about the dataset itself, and per this environment's own guidance it
should be reported rather than routed around.

## What could be confirmed (via search summaries only, not primary sources)

- 282,000+ videos covering 3,215 Auslan glosses from 73 signers.
- Filmed with four RGB-D cameras (three Kinect-V2 + one RealSense) in a
  multi-view studio rig.
- Released under CC BY-NC-SA 4.0.

These figures are consistent with the (unverifiable-from-here) prior research
brief. They were not confirmed against the primary paper or dataset page in
this session, so they should be re-verified before being relied on.

## What could not be confirmed

- Whether the RGB/depth video files are directly downloadable or sit behind a
  request form, signed data-use agreement, or institutional-affiliation
  requirement (the project's stopping condition for gated access).
- Any redistribution/derivative-use restriction beyond the general
  NC-SA terms (e.g. whether extracting and shipping MediaPipe landmarks
  derived from the video counts as a permitted derivative under NC-SA).
- Signer-ID availability in the released annotations (the prior brief claimed
  the downloaded JSON mappings omit signer IDs, which would block a
  signer-independent evaluation split; unverified here).

## Recommendation

Do not build a MediaPipe-native Auslan adapter, browser model, or any
training pipeline from this state — none of the required access/licence
facts are verified, and the project's own policy is to stop at an unclear
access boundary rather than guess. Auslan should remain marked
"Model preparing" in `lib/model-adapters.ts` and the README.

Next step needs one of:

1. A session/environment with unblocked access to `uq-cvlab.github.io`,
   `arxiv.org`, and `huggingface.co` to read the actual access terms, or
2. The repository owner fetching the access page directly and pasting the
   licence/download-mechanism text for evaluation, or
3. Treating Auslan as blocked and prioritising other work (e.g. independent
   live-camera/signer-held-out evaluation of the six already-installed
   languages, which remains outstanding per the 17 September handoff).
