"""Evaluate the exported WLASL1000 checkpoint on official held-out poses."""

from __future__ import annotations

import argparse
import json
import math
import random
import zipfile
from pathlib import Path

import numpy as np

from export_wlasl1000_tgcn import infer, read_legacy_state_dict


BODY_POSE_EXCLUDE = {9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24}


def sample_four(frame_start: int, frame_end: int, frames_per_copy: int = 50) -> list[int]:
    frame_count = frame_end - frame_start + 1
    if frame_count <= frames_per_copy:
        frames = list(range(frame_start, frame_end + 1))
        frames.extend([frame_end] * (frames_per_copy - frame_count))
        return frames * 4
    if frames_per_copy * 4 < frame_count:
        middle = (frame_start + frame_end) // 2
        start = middle - frames_per_copy * 4 // 2
        return list(range(start, start + frames_per_copy * 4))
    stride = math.floor((frame_count - frames_per_copy) / 3)
    return [
        frame
        for copy in range(4)
        for frame in range(frame_start + copy * stride, frame_start + copy * stride + frames_per_copy)
    ]


def pose_from_json(payload: bytes) -> np.ndarray | None:
    people = json.loads(payload)["people"]
    if not people:
        return None
    person = people[0]
    values = person["pose_keypoints_2d"] + person["hand_left_keypoints_2d"] + person["hand_right_keypoints_2d"]
    points = [
        (values[index * 3], values[index * 3 + 1])
        for index in range(len(values) // 3)
        if index not in BODY_POSE_EXCLUDE
    ]
    if len(points) != 55:
        raise ValueError(f"Expected 55 OpenPose points, found {len(points)}")
    return 2.0 * (np.asarray(points, dtype=np.float32) / 256.0 - 0.5)


def load_four_copies(archive: zipfile.ZipFile, instance: dict) -> np.ndarray | None:
    poses: list[np.ndarray] = []
    previous: np.ndarray | None = None
    for frame in sample_four(int(instance["frame_start"]), int(instance["frame_end"])):
        name = f"pose_per_individual_videos/{instance['video_id']}/image_{frame:05d}_keypoints.json"
        try:
            pose = pose_from_json(archive.read(name))
        except KeyError:
            pose = None
        if pose is None:
            pose = previous
        if pose is not None:
            poses.append(pose)
            previous = pose
    if not poses:
        return None
    while len(poses) < 200:
        poses.append(poses[-1])
    values = np.asarray(poses[:200], dtype=np.float32).reshape(4, 50, 55, 2)
    return values.transpose(0, 2, 1, 3).reshape(4, 55, 100)


def probabilities(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits)
    values = np.exp(shifted)
    return values / values.sum()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("split", type=Path)
    parser.add_argument("poses", type=Path)
    parser.add_argument("--samples", type=int, default=40)
    parser.add_argument("--seed", type=int, default=20260825)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    state = read_legacy_state_dict(args.checkpoint)
    entries = json.loads(args.split.read_text(encoding="utf-8"))
    labels = sorted(str(entry["gloss"]).strip().upper() for entry in entries)
    label_index = {label: index for index, label in enumerate(labels)}
    test_instances = [
        (str(entry["gloss"]).strip().upper(), instance)
        for entry in entries
        for instance in entry["instances"]
        if instance["split"] == "test"
    ]
    random.Random(args.seed).shuffle(test_instances)

    records: list[dict] = []
    agreements = 0
    with zipfile.ZipFile(args.poses) as archive:
        for gloss, instance in test_instances:
            copies = load_four_copies(archive, instance)
            if copies is None:
                continue
            original_logits = infer(state, copies, quantised=False).mean(axis=0)
            quantised_logits = infer(state, copies, quantised=True).mean(axis=0)
            original_rank = np.argsort(original_logits)[::-1]
            quantised_rank = np.argsort(quantised_logits)[::-1]
            target = label_index[gloss]
            scores = probabilities(quantised_logits)
            records.append({
                "video_id": instance["video_id"],
                "gloss": gloss,
                "target": target,
                "prediction": labels[int(quantised_rank[0])],
                "correct_top1": bool(int(quantised_rank[0]) == target),
                "correct_top5": bool(target in quantised_rank[:5]),
                "confidence": float(scores[quantised_rank[0]]),
                "margin": float(scores[quantised_rank[0]] - scores[quantised_rank[1]]),
                "quantised_matches_original": bool(quantised_rank[0] == original_rank[0]),
            })
            agreements += int(quantised_rank[0] == original_rank[0])
            if len(records) >= args.samples:
                break

    if not records:
        raise RuntimeError("No held-out pose samples could be read")
    report = {
        "sample_count": len(records),
        "top1": sum(record["correct_top1"] for record in records) / len(records),
        "top5": sum(record["correct_top5"] for record in records) / len(records),
        "quantised_top1_agreement": agreements / len(records),
        "mean_confidence": float(np.mean([record["confidence"] for record in records])),
        "median_confidence": float(np.median([record["confidence"] for record in records])),
        "mean_margin": float(np.mean([record["margin"] for record in records])),
        "records": records,
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "records"}, indent=2))


if __name__ == "__main__":
    main()
