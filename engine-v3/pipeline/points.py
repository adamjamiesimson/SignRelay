"""Landmark selection contract shared by training, ONNX export and the browser.

The model input is [T, 86, 3]: per frame, 86 points with aspect-corrected x, y
(x * W / max(W, H), y * H / max(W, H)) and the MediaPipe z, with NaN replaced by
0 and a parallel validity mask. Point order:
  0..20   hand slot 0 (MediaPipe handedness "Left")
  21..41  hand slot 1 (MediaPipe handedness "Right")
  42..54  pose (13 upper-body points of Pose Landmarker)
  55..85  face (31 Face Landmarker mesh points, symmetric pairs)
`MIRROR` maps each point to its horizontal mirror image (used by flip augmentation).
"""
import json

POSE = [0, 2, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
POSE_MIRROR = {0: 0, 2: 5, 5: 2, 7: 8, 8: 7, 9: 10, 10: 9, 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15}
FACE = [0, 17, 1, 152, 10, 61, 291, 185, 409, 40, 270, 39, 269, 37, 267, 146, 375, 91, 321, 181, 405, 84, 314,
        33, 263, 133, 362, 70, 300, 105, 334][:30]
FACE = [0, 17, 1, 152, 10, 61, 291, 185, 409, 40, 270, 39, 269, 37, 267, 146, 375, 91, 321, 181, 405, 84, 314,
        33, 263, 133, 362, 70, 300, 105, 334]
FACE_PAIRS = {61: 291, 185: 409, 40: 270, 39: 269, 37: 267, 146: 375, 91: 321, 181: 405, 84: 314, 33: 263, 133: 362,
              70: 300, 105: 334}
FACE_MIRROR = {**FACE_PAIRS, **{v: k for k, v in FACE_PAIRS.items()}, 0: 0, 17: 17, 1: 1, 152: 152, 10: 10}

N_HAND = 21
P_POSE0 = 2 * N_HAND
P_FACE0 = P_POSE0 + len(POSE)
N_POINTS = P_FACE0 + len(FACE)

SHOULDERS = (P_POSE0 + POSE.index(11), P_POSE0 + POSE.index(12))


def mirror_index():
    m = list(range(N_HAND, 2 * N_HAND)) + list(range(N_HAND))
    m += [P_POSE0 + POSE.index(POSE_MIRROR[p]) for p in POSE]
    m += [P_FACE0 + FACE.index(FACE_MIRROR[p]) for p in FACE]
    return m


MIRROR = mirror_index()


def contract():
    return {"points": N_POINTS, "hand_slots": ["Left", "Right"], "pose_indices": POSE, "face_indices": FACE,
            "mirror": MIRROR, "shoulders": list(SHOULDERS),
            "coordinates": "x*W/max(W,H), y*H/max(W,H), z as reported; missing -> 0 with mask 0"}


if __name__ == "__main__":
    print(json.dumps(contract()))
