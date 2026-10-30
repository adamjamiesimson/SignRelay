"""Sprint 8 ASL-2000 condition evaluation (diagnostic; never ships data).

Condition A  publisher OpenPose keypoints for the frozen sample:
             - official float32 checkpoint with the publisher test protocol;
             - the shipped int8 browser model on identical tensors;
             - the same keypoints routed through SignRelay's production
               MediaPipe-shaped adapter and temporal sampling variants.
Condition B  the same WLASL test videos (direct, non-YouTube sources) processed
             by MediaPipe Tasks with SignRelay's adapter, plus a per-frame
             geometric comparison against the publisher's OpenPose keypoints.

Raw video, keypoints and landmarks stay on the machine that runs this. Output
is aggregate metrics and per-instance predictions (labels, ranks, scores).

Usage (see .github/workflows/asl2000-diagnostics.yml):
  python training/asl2000_conditions.py official ...
  python training/asl2000_conditions.py mediapipe ...
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tgcn_packed import PackedTgcn, decide  # noqa: E402

BODY_POSE_EXCLUDE = {9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24}
# MediaPipe pose index <- OpenPose BODY_25 index (anatomical, same video).
MP_FROM_OPENPOSE = {0: 0, 2: 16, 5: 15, 7: 18, 8: 17, 11: 5, 12: 2, 13: 6, 14: 3, 15: 7, 16: 4, 23: 12, 24: 9}
FPS = 25  # WLASL_v0.3 reports 25 fps for every instance.
USER_AGENT = "SignRelay academic evaluation (C-UDA; low-rate; raw media never redistributed)"


# --------------------------------------------------------------------------
# Publisher input (dxli94/WLASL code/TGCN/sign_dataset.py)

def k_copies(frame_start: int, frame_end: int, samples: int, copies: int) -> list[int]:
    count = frame_end - frame_start + 1
    if count <= samples:
        frames = list(range(frame_start, frame_end + 1)) + [frame_end] * (samples - count)
        return frames * copies
    if samples * copies < count:
        start = (frame_start + frame_end) // 2 - samples * copies // 2
        return [start + copy * samples + i for copy in range(copies) for i in range(samples)]
    stride = math.floor((count - samples) / (copies - 1))
    return [frame_start + copy * stride + i for copy in range(copies) for i in range(samples)]


POSE_PREFIX = "pose_per_individual_videos/"


def read_keypoints(archive: zipfile.ZipFile, video_id: str, frame: int) -> dict | None:
    try:
        people = json.loads(archive.read(f"{POSE_PREFIX}{video_id}/image_{frame:05d}_keypoints.json"))["people"]
    except KeyError:
        return None
    return people[0] if people else None


def publisher_points(person: dict) -> np.ndarray:
    values = person["pose_keypoints_2d"] + person["hand_left_keypoints_2d"] + person["hand_right_keypoints_2d"]
    points = [(values[i * 3], values[i * 3 + 1]) for i in range(len(values) // 3) if i not in BODY_POSE_EXCLUDE]
    return 2.0 * (np.asarray(points, dtype=np.float32) / 256.0 - 0.5)


def publisher_tensor(archive: zipfile.ZipFile, video_id: str, frame_start: int, frame_end: int, copies: int) -> np.ndarray | None:
    """(copies, 55, 100) exactly as Sign_Dataset._load_poses + test_tgcn."""
    poses: list[np.ndarray] = []
    for frame in k_copies(frame_start, frame_end, 50, copies):
        person = read_keypoints(archive, video_id, frame)
        if person is not None:
            poses.append(publisher_points(person))
        elif poses:
            poses.append(poses[-1])
    if not poses:
        return None
    while len(poses) < 50 * copies:
        poses.append(poses[-1])
    values = np.asarray(poses[:50 * copies], dtype=np.float32).reshape(copies, 50, 55, 2)
    return values.transpose(0, 2, 1, 3).reshape(copies, 55, 100)


def last_frames(archive: zipfile.ZipFile) -> dict[str, int]:
    """Highest keypoint frame number per video, from one pass over the archive.
    Also detects the archive's folder prefix instead of assuming it."""
    global POSE_PREFIX
    last: dict[str, int] = {}
    for name in archive.namelist():
        if not name.endswith("_keypoints.json"):
            continue
        folder, video, file = name.rsplit("/", 2)
        POSE_PREFIX = f"{folder}/"
        last[video] = max(last.get(video, 0), int(file[-20:-15]))
    if not last:
        raise SystemExit("No OpenPose keypoint files found in the pose archive")
    return last


def frame_range(last: dict[str, int], video_id: str, frame_start: int, frame_end: int) -> tuple[int, int]:
    if frame_end > 0:
        return frame_start, frame_end
    return frame_start, last.get(video_id, frame_start)


# --------------------------------------------------------------------------
# OpenPose -> MediaPipe-shaped VisionFrame (what SignRelay's adapter consumes)

def openpose_to_frame(person: dict | None, timestamp: float, mediapipe_like_hands: bool = True) -> dict:
    """Pixel coordinates / 256 -> [0, 1], matching the publisher's normalisation.
    Detected hand points carry visibility 0 exactly as MediaPipe Tasks reports
    them; undetected OpenPose points (0, 0) become null so every adapter drops
    them. Body points carry visibility 1 (detected) or 0."""
    pose = [{"x": 0.0, "y": 0.0, "z": 0.0, "visibility": 0.0} for _ in range(33)]
    hands = []
    if person is not None:
        body = person["pose_keypoints_2d"]
        for mp_index, op_index in MP_FROM_OPENPOSE.items():
            x, y = body[op_index * 3], body[op_index * 3 + 1]
            if x or y:
                pose[mp_index] = {"x": x / 256.0, "y": y / 256.0, "z": 0.0, "visibility": 1.0}
        for side, key in (("Left", "hand_left_keypoints_2d"), ("Right", "hand_right_keypoints_2d")):
            values = person[key]
            points = [(values[i * 3], values[i * 3 + 1]) for i in range(21)]
            if not any(x or y for x, y in points):
                continue
            hands.append({
                # null (non-finite in JS) for an undetected point: every adapter drops it.
                "landmarks": [{"x": x / 256.0 if (x or y) else None, "y": y / 256.0 if (x or y) else None, "z": 0.0,
                               "visibility": 0.0 if mediapipe_like_hands else 1.0} for x, y in points],
                "handedness": side, "gesture": "None", "gestureScore": 0.0,
            })
    return {"timestamp": timestamp, "hands": hands, "face": [], "pose": pose}


def swap_labels(frame: dict) -> dict:
    swapped = {"Left": "Right", "Right": "Left"}
    return {**frame, "hands": [{**hand, "handedness": swapped.get(hand["handedness"], hand["handedness"])} for hand in frame["hands"]]}


def live_cadence(frames: list[dict], hand_interval_ms: float = 50.0) -> list[dict]:
    """Model the live tracker on a 25 fps source: hands every 50 ms of media
    time; face/pose only when >= 150 ms and >= 2 hand frames since the last
    auxiliary update (lib/vision-engine.ts), held in between."""
    if not frames:
        return []
    out, last_aux, since_aux, pose = [], -math.inf, 2, None
    end = frames[-1]["timestamp"]
    t, source = frames[0]["timestamp"], 0
    while t <= end + 1e-6:
        while source + 1 < len(frames) and frames[source + 1]["timestamp"] <= t + 1e-6:
            source += 1
        since_aux += 1
        if since_aux >= 2 and t - last_aux >= 150:
            pose, last_aux, since_aux = frames[source]["pose"], t, 0
        out.append({**frames[source], "timestamp": t, "pose": pose})
        t += hand_interval_ms
    return out


# --------------------------------------------------------------------------
# Production TypeScript preprocessing via the bundled CLI

class CaseWriter:
    """Streams frame sequences to disk; only identifiers stay in memory."""

    def __init__(self, workdir: Path, name: str) -> None:
        workdir.mkdir(parents=True, exist_ok=True)
        self.path = workdir / f"{name}-cases.jsonl"
        self.handle = self.path.open("w", encoding="utf-8")
        self.cases: list[dict] = []

    def add(self, case_id: str, frames: list[dict], base: dict) -> None:
        self.handle.write(json.dumps({"id": case_id, "frames": frames}, allow_nan=False, separators=(",", ":")) + "\n")
        self.cases.append({"id": case_id, "base": base})

    def close(self) -> None:
        self.handle.close()


def run_preprocess(node_bundle: Path, cases_path: Path, variants: dict, workdir: Path, name: str) -> dict[tuple[str, str], np.ndarray]:
    workdir.mkdir(parents=True, exist_ok=True)
    variants_path = workdir / f"{name}-variants.json"
    variants_path.write_text(json.dumps(variants), encoding="utf-8")
    prefix = workdir / f"{name}-windows"
    subprocess.run(["node", str(node_bundle), str(cases_path), str(variants_path), str(prefix)], check=True)
    windows = np.fromfile(f"{prefix}.bin", dtype="<f4").reshape(-1, 55, 100)
    result = {}
    for line in Path(f"{prefix}.jsonl").read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        result[(row["id"], row["variant"])] = windows[row["offset"]:row["offset"] + row["windows"]]
    return result


# --------------------------------------------------------------------------
# Scoring

def summarize(records: list[dict]) -> dict:
    if not records:
        return {"n": 0}
    ranks = [r["rank"] for r in records]
    accepted = [r for r in records if r["accepted"]]
    correct_accepted = [r for r in accepted if r["rank"] == 1]
    return {
        "n": len(records),
        "top1": round(sum(rank == 1 for rank in ranks) / len(ranks), 4),
        "top5": round(sum(rank <= 5 for rank in ranks) / len(ranks), 4),
        "top10": round(sum(rank <= 10 for rank in ranks) / len(ranks), 4),
        "median_rank": statistics.median(ranks),
        "mean_top1_confidence": round(statistics.fmean(r["confidence"] for r in records), 4),
        "confidence_quartiles": [round(q, 4) for q in np.quantile([r["confidence"] for r in records], [0.25, 0.5, 0.75])],
        "gate_accepted": len(accepted),
        "gate_accepted_correct": len(correct_accepted),
        "gate_accepted_wrong": len(accepted) - len(correct_accepted),
        "gate_precision": round(len(correct_accepted) / len(accepted), 4) if accepted else None,
        "correct_top1_rejected_by_gate": sum(1 for r in records if r["rank"] == 1 and not r["accepted"]),
    }


def score(model: PackedTgcn, windows: np.ndarray, target: int) -> dict:
    return decide(model.logits(windows).mean(axis=0), model.labels, target)


def selected_instances(sample: dict) -> list[tuple[str, dict]]:
    out = [("everyday", item) for item in sample["groups"]["everyday"]]
    out += [(f"tier{index + 1}", item) for index, tier in enumerate(sample["groups"]["tiers"]) for item in tier["instances"]]
    out += [("random", item) for item in sample["groups"]["random"]]
    return out


def grouped(records: list[dict]) -> dict:
    groups: dict[str, list[dict]] = {"all-unique": list({r["video_id"]: r for r in records}.values())}
    for record in records:
        groups.setdefault(record["group"], []).append(record)
        if record["group"].startswith("tier"):
            groups.setdefault("tiers-all", []).append(record)
    return {name: summarize(items) for name, items in sorted(groups.items())}


def framing_target(archive: zipfile.ZipFile, split: list[dict], names: dict[str, int], count: int = 300) -> dict:
    """Median signer framing over seeded TRAIN-split instances (never test)."""
    rng = random.Random(20261030)
    train = [(entry["gloss"], inst) for entry in split for inst in entry["instances"] if inst["split"] == "train"]
    necks_x, necks_y, widths, heights = [], [], [], []
    for _, inst in rng.sample(train, count):
        start, end = frame_range(names, inst["video_id"], inst["frame_start"], inst["frame_end"])
        vx, vy, vw, vh = [], [], [], []
        for frame in range(start, end + 1, 3):
            person = read_keypoints(archive, inst["video_id"], frame)
            if not person:
                continue
            p = publisher_points(person)
            raw = person["pose_keypoints_2d"]
            if raw[1 * 3] or raw[1 * 3 + 1]:
                vx.append(float(p[1, 0])); vy.append(float(p[1, 1]))
            if (raw[2 * 3] or raw[2 * 3 + 1]) and (raw[5 * 3] or raw[5 * 3 + 1]):
                vw.append(abs(float(p[2, 0] - p[5, 0])))
            if all(raw[i * 3] or raw[i * 3 + 1] for i in (1, 15, 16)):
                vh.append(float(p[1, 1] - (p[9, 1] + p[10, 1]) / 2))
        if vx and vw:
            necks_x.append(statistics.median(vx)); necks_y.append(statistics.median(vy)); widths.append(statistics.median(vw))
        if vh:
            heights.append(statistics.median(vh))
    return {"neck": {"x": statistics.median(necks_x), "y": statistics.median(necks_y)},
            "shoulderWidth": statistics.median(widths), "eyeHeight": statistics.median(heights),
            "train_instances": len(widths)}


def variants_for(framing: dict | None) -> dict:
    base = {"hands": "label", "fillGapMs": 0, "framing": None, "handVisibility": "ignore"}
    publisher = {"mode": "publisher", "fps": FPS, "copies": 4}
    variants = {
        "v1-shipped": {"temporal": {"mode": "stretch"}, "hands": "label", "fillGapMs": 0, "framing": None, "handVisibility": "zero-means-missing"},
        "hands-stretch": {**base, "temporal": {"mode": "stretch"}},
        "hands-publisher4": {**base, "temporal": publisher},
        "hands-publisher1": {**base, "temporal": {**publisher, "copies": 1}},
        "hands-publisher4-wrist": {**base, "temporal": publisher, "hands": "pose-wrist"},
        "hands-publisher4-wrist-fill": {**base, "temporal": publisher, "hands": "pose-wrist", "fillGapMs": 240},
        "hands-stretch-wrist-fill": {**base, "temporal": {"mode": "stretch"}, "hands": "pose-wrist", "fillGapMs": 240},
    }
    if framing:
        target = {key: framing[key] for key in ("neck", "shoulderWidth", "eyeHeight")}
        variants["hands-publisher4-wrist-fill-framing"] = {**variants["hands-publisher4-wrist-fill"], "framing": target}
    return variants


# --------------------------------------------------------------------------
# Condition A

def command_official(args: argparse.Namespace) -> None:
    from export_wlasl1000_tgcn import infer, read_legacy_state_dict

    sample = json.loads(args.sample.read_text(encoding="utf-8"))
    split = json.loads(args.split.read_text(encoding="utf-8"))
    labels_lower = sorted(entry["gloss"] for entry in split)
    target_of = {gloss.upper(): index for index, gloss in enumerate(labels_lower)}
    split_instances = {inst["video_id"]: (entry["gloss"].upper(), inst) for entry in split for inst in entry["instances"]}
    model = PackedTgcn(args.model)
    if [label for label in model.labels] != [gloss.upper() for gloss in labels_lower]:
        raise SystemExit("Shipped labels differ from the publisher LabelEncoder order")
    state = read_legacy_state_dict(args.checkpoint)
    archive = zipfile.ZipFile(args.poses)
    names = last_frames(archive)

    framing = framing_target(archive, split, names)
    variants = variants_for(framing)
    writer = CaseWriter(args.workdir, "official")
    records, official_inputs, coordinate_stats = [], [], {"max_x_px": 0.0, "max_y_px": 0.0, "points": 0, "outside_256": 0}
    presence = {"frames": 0, "left": 0, "right": 0, "both": 0}
    skipped = []
    for group, item in selected_instances(sample):
        vid = item["video_id"]
        if vid not in split_instances or split_instances[vid][1]["split"] != "test" or split_instances[vid][0] != item["gloss"]:
            skipped.append({"video_id": vid, "reason": "not a test instance of this gloss in splits/asl2000.json"})
            continue
        inst = split_instances[vid][1]
        start, end = frame_range(names, vid, inst["frame_start"], inst["frame_end"])
        k4 = publisher_tensor(archive, vid, start, end, 4)
        if k4 is None:
            skipped.append({"video_id": vid, "reason": "no publisher keypoints"})
            continue
        c1 = publisher_tensor(archive, vid, start, end, 1)
        target = target_of[item["gloss"]]
        frames = []
        for frame in range(start, end + 1):
            person = read_keypoints(archive, vid, frame)
            if person is None:
                continue
            presence["frames"] += 1
            left = any(person["hand_left_keypoints_2d"][i * 3] for i in range(21))
            right = any(person["hand_right_keypoints_2d"][i * 3] for i in range(21))
            presence["left"] += left; presence["right"] += right; presence["both"] += left and right
            values = person["pose_keypoints_2d"] + person["hand_left_keypoints_2d"] + person["hand_right_keypoints_2d"]
            xs, ys = values[0::3], values[1::3]
            coordinate_stats["max_x_px"] = max(coordinate_stats["max_x_px"], max(xs))
            coordinate_stats["max_y_px"] = max(coordinate_stats["max_y_px"], max(ys))
            nonzero = [(x, y) for x, y in zip(xs, ys) if x or y]
            coordinate_stats["points"] += len(nonzero)
            coordinate_stats["outside_256"] += sum(1 for x, y in nonzero if x > 256 or y > 256)
            frames.append(openpose_to_frame(person, (frame - start) * 1000.0 / FPS))
        if len(frames) < 6:
            skipped.append({"video_id": vid, "reason": "fewer than 6 keypoint frames"})
            continue
        base = {"video_id": vid, "gloss": item["gloss"], "group": group, "target": target, "frames": len(frames)}
        t0 = time.perf_counter()
        original_k4 = decide(infer(state, k4, quantised=False).mean(axis=0), model.labels, target)
        original_ms = (time.perf_counter() - t0) * 1000
        shipped_k4 = score(model, k4, target)
        records.append({**base, "condition": "A-official-float32-k4", **original_k4, "numpy_ms": round(original_ms, 1)})
        records.append({**base, "condition": "A-official-shipped-int8-k4", **shipped_k4})
        records.append({**base, "condition": "A-official-shipped-int8-center1", **score(model, c1, target)})
        records.append({**base, "condition": "A-official-float32-center1", **decide(infer(state, c1, quantised=False).mean(axis=0), model.labels, target)})
        hands_erased = c1.copy(); hands_erased[:, 13:, :] = -1.0
        records.append({**base, "condition": "A-official-shipped-int8-center1-hands-erased", **score(model, hands_erased, target)})
        official_inputs.append(k4[0])
        writer.add(f"{vid}|exact", frames, base)
        writer.add(f"{vid}|swapped", [swap_labels(frame) for frame in frames], base)
        writer.add(f"{vid}|live", live_cadence(frames), base)

    writer.close()
    windows = run_preprocess(args.node_preprocess, writer.path, variants, args.workdir, "official")
    for case in writer.cases:
        vid, flavour = case["id"].split("|")
        names_for_flavour = list(variants) if flavour != "swapped" else ["hands-publisher4", "hands-publisher4-wrist"]
        for variant in names_for_flavour:
            records.append({**case["base"], "condition": f"A-adapter-{flavour}-{variant}", **score(model, windows[(case["id"], variant)], case["base"]["target"])})

    parity = js_parity(args, model, state, np.asarray(official_inputs[: args.parity], dtype=np.float32), infer)
    by_condition: dict[str, list[dict]] = {}
    for record in records:
        by_condition.setdefault(record["condition"], []).append(record)
    report = {
        "condition": "A",
        "sample_sha256_note": "frozen sample: docs/evaluation/asl2000-sprint8/frozen-sample.json",
        "instances_evaluated": len({r["video_id"] for r in records}),
        "skipped": skipped,
        "framing_target_from_train_split": framing,
        "publisher_coordinate_check": {**coordinate_stats, "fraction_outside_256": coordinate_stats["outside_256"] / max(1, coordinate_stats["points"])},
        "publisher_hand_presence": {key: (value / presence["frames"] if key != "frames" else value) for key, value in presence.items()},
        "parity": parity,
        "summary": {condition: grouped(items) for condition, items in sorted(by_condition.items())},
    }
    write_report(args.output, report, records)


def js_parity(args, model: PackedTgcn, state, inputs: np.ndarray, infer) -> dict:
    if not len(inputs):
        return {}
    path = args.workdir / "parity-windows.bin"
    inputs.astype("<f4").tofile(path)
    output = args.workdir / "parity-logits.bin"
    completed = subprocess.run(["node", str(args.node_infer), str(path), str(output)], check=True, capture_output=True, text=True)
    timing = json.loads(completed.stdout.strip().splitlines()[-1])
    js = np.fromfile(output, dtype="<f4").reshape(len(inputs), -1)
    replica = model.logits(inputs)
    original = infer(state, inputs, quantised=False)
    return {
        "windows": len(inputs),
        "js_vs_numpy_replica_max_abs_logit": float(np.max(np.abs(js - replica))),
        "js_vs_numpy_replica_top1_agreement": float(np.mean(js.argmax(1) == replica.argmax(1))),
        "js_int8_vs_original_float32_top1_agreement": float(np.mean(js.argmax(1) == original.argmax(1))),
        "js_int8_vs_original_float32_top5_overlap": float(np.mean([len(set(np.argsort(-a)[:5]) & set(np.argsort(-b)[:5])) / 5 for a, b in zip(js, original)])),
        "js_int8_vs_original_float32_max_abs_logit": float(np.max(np.abs(js - original))),
        **timing,
    }


def table(summary: dict) -> str:
    lines = ["condition | group | n | top1 | top5 | top10 | median rank | gate accepted (correct/wrong) | correct top-1 rejected"]
    for condition, groups in summary.items():
        for group in ("all-unique", "everyday", "tiers-all", "random"):
            m = groups.get(group)
            if not m or not m.get("n"):
                continue
            lines.append(f"{condition} | {group} | {m['n']} | {m['top1']:.3f} | {m['top5']:.3f} | {m['top10']:.3f} | {m['median_rank']} | "
                         f"{m['gate_accepted']} ({m['gate_accepted_correct']}/{m['gate_accepted_wrong']}) | {m['correct_top1_rejected_by_gate']}")
    return "\n".join(lines)


def write_report(path: Path, report: dict, records: list[dict]) -> None:
    print(table(report["summary"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    with path.with_suffix(".records.jsonl").open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key not in {"skipped", "summary"}}, indent=1))


# --------------------------------------------------------------------------
# Condition B

def is_video(data: bytes) -> bool:
    return data[4:8] == b"ftyp" or data.startswith(b"\x1aE\xdf\xa3") or data[:3] == b"FLV" or data[:4] == b"RIFF"


def download(url: str, path: Path) -> str:
    if path.exists():
        return "cached"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            data = response.read(60 * 1024 * 1024)
    except Exception as error:  # noqa: BLE001 - record and continue
        return f"error:{type(error).__name__}"
    if not is_video(data[:16]):
        return "not-video"
    path.write_bytes(data)
    return "ok"


def decode(path: Path) -> tuple[list[np.ndarray], float, tuple[int, int]]:
    import cv2
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
    frames = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    capture.release()
    size = (frames[0].shape[1], frames[0].shape[0]) if frames else (0, 0)
    return frames, fps, size


class MediaPipeTracker:
    """MediaPipe Tasks with the browser's models and thresholds; hands AND pose
    every frame (the browser refreshes pose at most every 150 ms; condition C
    covers that)."""

    def __init__(self, models: Path) -> None:
        import mediapipe as mp
        from mediapipe.tasks import python as tasks
        from mediapipe.tasks.python import vision
        self.mp, self.vision = mp, vision
        self.hands = vision.GestureRecognizer.create_from_options(vision.GestureRecognizerOptions(
            base_options=tasks.BaseOptions(model_asset_path=str(models / "gesture_recognizer.task")),
            running_mode=vision.RunningMode.VIDEO, num_hands=2, min_hand_detection_confidence=0.55,
            min_hand_presence_confidence=0.55, min_tracking_confidence=0.55))
        self.pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=tasks.BaseOptions(model_asset_path=str(models / "pose_landmarker_lite.task")),
            running_mode=vision.RunningMode.VIDEO, num_poses=1, min_pose_detection_confidence=0.55,
            min_pose_presence_confidence=0.55, min_tracking_confidence=0.55))
        self.clock = 0

    def close(self) -> None:
        self.hands.close()
        self.pose.close()

    def frame(self, rgb: np.ndarray, timestamp: float) -> dict:
        image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        self.clock += 40  # Tasks VIDEO mode needs monotonic timestamps across clips.
        hands = self.hands.recognize_for_video(image, self.clock)
        pose = self.pose.detect_for_video(image, self.clock)
        return {
            "timestamp": timestamp,
            # Hands carry visibility 0, as the browser Tasks bundle reports them.
            "hands": [{"landmarks": [{"x": p.x, "y": p.y, "z": p.z, "visibility": 0.0} for p in landmarks],
                       "handedness": (hands.handedness[i][0].category_name if hands.handedness[i] else "Unknown"),
                       "gesture": "None", "gestureScore": 0.0}
                      for i, landmarks in enumerate(hands.hand_landmarks)],
            "face": [],
            "pose": [{"x": p.x, "y": p.y, "z": p.z, "visibility": p.visibility if p.visibility is not None else 1.0}
                     for p in (pose.pose_landmarks[0] if pose.pose_landmarks else [])],
        }


def command_mediapipe(args: argparse.Namespace) -> None:
    sample = json.loads(args.sample.read_text(encoding="utf-8"))
    index = {inst["video_id"]: inst for entry in json.loads(args.index.read_text(encoding="utf-8")) for inst in entry["instances"]}
    split = json.loads(args.split.read_text(encoding="utf-8"))
    target_of = {entry["gloss"].upper(): i for i, entry in enumerate(sorted(split, key=lambda e: e["gloss"]))}
    split_instances = {inst["video_id"]: inst for entry in split for inst in entry["instances"]}
    framing = json.loads(args.framing.read_text(encoding="utf-8"))["framing_target_from_train_split"] if args.framing else None
    model = PackedTgcn(args.model)
    archive = zipfile.ZipFile(args.poses)
    names = last_frames(archive)
    tracker = MediaPipeTracker(args.vision_models)
    args.videos.mkdir(parents=True, exist_ok=True)
    downloads: dict[str, int] = {}
    writer = CaseWriter(args.workdir, "mediapipe")
    hand_fractions: list[float] = []
    clips: list[dict] = []
    geometry, alignment, label_checks = [], [], {"identity": 0, "time": 0, "rejected": 0}, {"frames": 0, "label_matches_openpose": 0, "wrist_rule_matches_openpose": 0}
    seen = set()
    last_request: dict[str, float] = {}
    for group, item in selected_instances(sample):
        vid = item["video_id"]
        source = index.get(vid)
        if vid in seen or not source or not item["direct_source"] or source["frame_start"] != 1 or source["frame_end"] != -1:
            continue
        seen.add(vid)
        host = item["url"].split("/")[2]
        wait = 1.0 - (time.time() - last_request.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        last_request[host] = time.time()
        path = args.videos / f"{vid}.video"
        status = download(item["url"], path)
        downloads[status.split(":")[0]] = downloads.get(status.split(":")[0], 0) + 1
        if status not in {"ok", "cached"}:
            continue
        rgb, native_fps, size = decode(path)
        inst = split_instances.get(vid)
        if not rgb or not inst:
            continue
        start, end = frame_range(names, vid, inst["frame_start"], inst["frame_end"])
        official_count = end - start + 1
        if abs(official_count - len(rgb)) <= 2:
            source_index = lambda k: min(k - 1, len(rgb) - 1)  # noqa: E731
            alignment["identity"] += 1
        elif native_fps and abs(official_count - len(rgb) * FPS / native_fps) <= 3:
            source_index = lambda k: min(round((k - 1) * native_fps / FPS), len(rgb) - 1)  # noqa: E731
            alignment["time"] += 1
        else:
            alignment["rejected"] += 1
            continue
        frames = []
        for k in range(start, end + 1):
            frame = tracker.frame(rgb[source_index(k)], (k - start) * 1000.0 / FPS)
            frames.append(frame)
            person = read_keypoints(archive, vid, k)
            if person:
                geometry.extend(compare_geometry(person, frame, size))
                check_labels(person, frame, label_checks)
        base = {"video_id": vid, "gloss": item["gloss"], "group": group, "target": target_of[item["gloss"]],
                "frames": len(frames), "native_fps": native_fps, "hand_frames": sum(1 for f in frames if f["hands"])}
        writer.add(f"{vid}|mp", frames, base)
        hand_fractions.append(base["hand_frames"] / base["frames"])
        clips.append({"id": vid, "file": str(path), "gloss": item["gloss"], "group": group})
    writer.close()
    tracker.close()
    (args.workdir / "clips.json").write_text(json.dumps(clips, indent=1), encoding="utf-8")
    variants = variants_for(framing)
    windows = run_preprocess(args.node_preprocess, writer.path, variants, args.workdir, "mediapipe")
    records = []
    for case in writer.cases:
        for variant in variants:
            records.append({**case["base"], "condition": f"B-mediapipe-{variant}", **score(model, windows[(case["id"], variant)], case["base"]["target"])})
    by_condition: dict[str, list[dict]] = {}
    for record in records:
        by_condition.setdefault(record["condition"], []).append(record)
    report = {
        "condition": "B",
        "mediapipe_python_version": __import__("mediapipe").__version__,
        "downloads": downloads, "frame_alignment": alignment, "clips_evaluated": len(writer.cases),
        "hand_frame_fraction": statistics.fmean(hand_fractions) if hand_fractions else None,
        "geometry_vs_publisher_openpose": summarize_geometry(geometry),
        "hand_assignment_vs_openpose": {**label_checks,
            "label_agreement": label_checks["label_matches_openpose"] / max(1, label_checks["frames"]),
            "wrist_rule_agreement": label_checks["wrist_rule_matches_openpose"] / max(1, label_checks["frames"])},
        "summary": {condition: grouped(items) for condition, items in sorted(by_condition.items())},
    }
    write_report(args.output, report, records)


# --------------------------------------------------------------------------
# Condition C

def command_live(args: argparse.Namespace) -> None:
    clips = {clip["id"]: clip for clip in json.loads(args.clips.read_text(encoding="utf-8"))}
    model = PackedTgcn(args.model)
    target_of = {label: index for index, label in enumerate(model.labels)}
    framing = json.loads(args.framing.read_text(encoding="utf-8"))["framing_target_from_train_split"] if args.framing else None
    variants = variants_for(framing)
    windows = run_preprocess(args.node_preprocess, args.cases, variants, args.workdir, "live")
    records = []
    for (case_id, variant), tensor in windows.items():
        clip_id, worker, pause, kind = case_id.split("|")
        clip = clips[clip_id]
        if worker != args.reference_worker:
            continue  # frames are identical across workers for the same pause
        records.append({"video_id": clip_id, "gloss": clip["gloss"], "group": clip["group"], "target": target_of[clip["gloss"]],
                        "condition": f"C-{kind}-pause{pause}-{variant}", **score(model, tensor, target_of[clip["gloss"]])})
    outcomes = [json.loads(line) for line in args.outcomes.read_text(encoding="utf-8").splitlines() if line.strip()]
    worker_summary: dict[str, dict] = {}
    for outcome in outcomes:
        clip = clips[outcome["id"]]
        key = f"{outcome['worker']}-pause{outcome['pauseMs']}"
        summary = worker_summary.setdefault(key, {"clips": 0, "errors": 0, "correct_confirmed": 0, "wrong_confirmed": 0, "no_confirmation": 0,
                                                  "correct_by_source": {}, "wrong_by_source": {}, "clips_with_model_inference": 0,
                                                  "model_inferences": 0, "model_ms": [], "clips_with_motion_ready": 0,
                                                  "clips_where_model_ever_proposed_expected": 0, "hand_frame_fraction": []})
        summary["clips"] += 1
        if outcome["error"]:
            summary["errors"] += 1
            continue
        confirmed = outcome["confirmations"]
        right = [c for c in confirmed if c["gloss"] == clip["gloss"]]
        wrong = [c for c in confirmed if c["gloss"] != clip["gloss"]]
        summary["correct_confirmed"] += bool(right)
        summary["wrong_confirmed"] += bool(wrong)
        summary["no_confirmation"] += not confirmed
        for c in right:
            summary["correct_by_source"][c["source"]] = summary["correct_by_source"].get(c["source"], 0) + 1
        for c in wrong:
            summary["wrong_by_source"][c["source"]] = summary["wrong_by_source"].get(c["source"], 0) + 1
        summary["clips_with_model_inference"] += outcome["model_inferences_completed"] > 0
        summary["model_inferences"] += outcome["model_inferences_completed"]
        summary["model_ms"] += outcome["model_inference_ms"]
        summary["clips_with_motion_ready"] += outcome["motion_ready_frames"] > 0
        summary["clips_where_model_ever_proposed_expected"] += clip["gloss"] in outcome["model_candidates"]
        summary["hand_frame_fraction"].append(outcome["hand_frames"] / max(1, outcome["frames"]))
    for summary in worker_summary.values():
        times = sorted(summary.pop("model_ms"))
        summary["model_ms_median_p90"] = [times[len(times) // 2], times[int(len(times) * 0.9)]] if times else None
        fractions = summary.pop("hand_frame_fraction")
        summary["mean_hand_frame_fraction"] = round(statistics.fmean(fractions), 3) if fractions else None
    by_condition: dict[str, list[dict]] = {}
    for record in records:
        by_condition.setdefault(record["condition"], []).append(record)
    report = {"condition": "C", "clips": len(clips), "worker_outcomes": worker_summary,
              "summary": {condition: grouped(items) for condition, items in sorted(by_condition.items())}}
    write_report(args.output, report, records)


GEOMETRY_POINTS = {"nose": (0, 0), "right_shoulder": (2, 12), "left_shoulder": (5, 11), "right_elbow": (3, 14),
                   "left_elbow": (6, 13), "right_wrist": (4, 16), "left_wrist": (7, 15)}


def compare_geometry(person: dict, frame: dict, size: tuple[int, int]) -> list[dict]:
    """Publisher OpenPose (px/256) vs MediaPipe normalised coordinates for the
    same decoded frame, under two hypotheses about the publisher's frame size."""
    out = []
    body = person["pose_keypoints_2d"]
    if len(frame["pose"]) == 33:
        for name, (op, mp_index) in GEOMETRY_POINTS.items():
            x, y = body[op * 3], body[op * 3 + 1]
            point = frame["pose"][mp_index]
            if (x or y) and point["visibility"] >= 0.3:
                out.append({"point": name, "op": (x / 256, y / 256), "mp": (point["x"], point["y"]), "size": size})
    for side, key in (("left", "hand_left_keypoints_2d"), ("right", "hand_right_keypoints_2d")):
        values = person[key]
        if not (values[0] or values[1]):
            continue
        nearest = min(frame["hands"], key=lambda h: math.hypot(h["landmarks"][0]["x"] - values[0] / 256, h["landmarks"][0]["y"] - values[1] / 256), default=None)
        if nearest:
            out.append({"point": f"{side}_hand_wrist", "op": (values[0] / 256, values[1] / 256),
                        "mp": (nearest["landmarks"][0]["x"], nearest["landmarks"][0]["y"]), "size": size})
    return out


def summarize_geometry(rows: list[dict]) -> dict:
    if not rows:
        return {}
    def error(scale: bool) -> list[float]:
        values = []
        for row in rows:
            sx, sy = (row["size"][0] / 256, row["size"][1] / 256) if scale else (1.0, 1.0)
            values.append(math.hypot(row["op"][0] - row["mp"][0] * sx, row["op"][1] - row["mp"][1] * sy))
        return values
    squashed, native = error(False), error(True)
    per_point = {}
    for name in sorted({row["point"] for row in rows}):
        subset = [row for row in rows if row["point"] == name]
        per_point[name] = {"n": len(subset), "median_error_model_units": round(2 * statistics.median(
            math.hypot(r["op"][0] - r["mp"][0], r["op"][1] - r["mp"][1]) for r in subset), 4)}
    return {
        "points": len(rows),
        "median_error_if_publisher_frames_were_256x256_model_units": round(2 * statistics.median(squashed), 4),
        "median_error_if_publisher_used_native_resolution_model_units": round(2 * statistics.median(native), 4),
        "per_point_256x256_hypothesis": per_point,
        "note": "Model units are the network's [-1, 1] input range; an error of 0.02 is 1% of frame width.",
    }


def check_labels(person: dict, frame: dict, checks: dict) -> None:
    """For frames where OpenPose found both hands and MediaPipe found two, is
    MediaPipe's 'Left' hand the publisher's signer-left hand?"""
    left, right = person["hand_left_keypoints_2d"], person["hand_right_keypoints_2d"]
    if not (left[0] or left[1]) or not (right[0] or right[1]) or len(frame["hands"]) != 2:
        return
    a, b = frame["hands"]
    def distance(hand, values):
        return math.hypot(hand["landmarks"][0]["x"] - values[0] / 256, hand["landmarks"][0]["y"] - values[1] / 256)
    truth_left = a if distance(a, left) + distance(b, right) <= distance(a, right) + distance(b, left) else b
    labelled_left = next((hand for hand in frame["hands"] if hand["handedness"] == "Left"), None)
    checks["frames"] += 1
    checks["label_matches_openpose"] += int(labelled_left is truth_left)
    if len(frame["pose"]) == 33 and frame["pose"][15]["visibility"] >= 0.3 and frame["pose"][16]["visibility"] >= 0.3:
        pl, pr = frame["pose"][15], frame["pose"][16]
        def d(hand, point):
            return math.hypot(hand["landmarks"][0]["x"] - point["x"], hand["landmarks"][0]["y"] - point["y"])
        wrist_left = a if d(a, pl) + d(b, pr) <= d(a, pr) + d(b, pl) else b
        checks["wrist_rule_matches_openpose"] += int(wrist_left is truth_left)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--sample", type=Path, default=Path("docs/evaluation/asl2000-sprint8/frozen-sample.json"))
    common.add_argument("--split", type=Path, required=True)
    common.add_argument("--poses", type=Path, required=True)
    common.add_argument("--model", type=Path, default=Path("public/models/asl2000-tgcn"))
    common.add_argument("--node-preprocess", type=Path, required=True)
    common.add_argument("--workdir", type=Path, required=True)
    common.add_argument("--output", type=Path, required=True)
    official = sub.add_parser("official", parents=[common])
    official.add_argument("--checkpoint", type=Path, required=True)
    official.add_argument("--node-infer", type=Path, required=True)
    official.add_argument("--parity", type=int, default=24)
    media = sub.add_parser("mediapipe", parents=[common])
    media.add_argument("--index", type=Path, required=True, help="WLASL_v0.3.json")
    media.add_argument("--videos", type=Path, required=True)
    media.add_argument("--vision-models", type=Path, default=Path("public/vision/models"))
    media.add_argument("--framing", type=Path, help="Condition A report with the train-split framing target")
    live = sub.add_parser("live")
    live.add_argument("--cases", type=Path, required=True)
    live.add_argument("--outcomes", type=Path, required=True)
    live.add_argument("--clips", type=Path, required=True)
    live.add_argument("--reference-worker", default="v1")
    live.add_argument("--framing", type=Path)
    live.add_argument("--model", type=Path, default=Path("public/models/asl2000-tgcn"))
    live.add_argument("--node-preprocess", type=Path, required=True)
    live.add_argument("--workdir", type=Path, required=True)
    live.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    {"official": command_official, "mediapipe": command_mediapipe, "live": command_live}[args.command](args)


if __name__ == "__main__":
    main()
