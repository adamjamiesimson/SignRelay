"""Run the whole ISLR merge-and-train chain inside a Kaggle notebook, where the data is already there.

Downloading the competition data is the slow part of this pipeline from a laptop (the bundle is ~40 GB
and the API throttles to a crawl). In a Kaggle notebook the competition files are mounted read-only at
/kaggle/input/asl-signs, so the same work needs no download at all: attach the competition to the
notebook, clone this repository, and run this script. The output is the merged cache, the training log
and an ONNX export that can be copied into the app.

  !git clone https://github.com/friendlyfoe241-cyber/SignRelay.git
  !pip install -q pyarrow onnx onnxruntime onnxscript
  !python SignRelay/engine-v3/pipeline/kaggle_islr_run.py --out-root /kaggle/working/islr

Everything it runs is the same code as on a laptop: import_islr.py, merge_cache.py, train.py and
export_onnx.py. It only decides the paths and passes the flags through.
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE, TRAIN = HERE, os.path.join(os.path.dirname(HERE), "train")
DEFAULT_INPUT = "/kaggle/input/asl-signs"


def run(script, *args, check=True):
    # train/ and export scripts live in their own directory; everything else is next to this file.
    base = TRAIN if os.path.exists(os.path.join(TRAIN, script)) else PIPELINE
    command = [sys.executable, os.path.join(base, script), *map(str, args)]
    print("$", " ".join(command), flush=True)
    result = subprocess.run(command, text=True)
    if check and result.returncode:
        raise SystemExit(f"{script} failed with exit code {result.returncode}")
    return result.returncode


def find_input(root):
    """The competition mounts as /kaggle/input/asl-signs; accept the directory that holds train.csv."""
    for candidate in (root, os.path.join(root, "asl-signs"), os.path.join(root, "train")):
        if os.path.exists(os.path.join(candidate, "train.csv")):
            landmarks = os.path.join(candidate, "train_landmark_files")
            if os.path.isdir(landmarks):
                return candidate, os.path.join(candidate, "train.csv"), landmarks
    raise SystemExit(f"no train.csv + train_landmark_files under {root}: attach the asl-signs competition "
                     "to this notebook (Add data -> Competitions -> Google - Isolated Sign Language Recognition)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-root", default=DEFAULT_INPUT)
    parser.add_argument("--out-root", default="/kaggle/working/islr")
    parser.add_argument("--per-class", type=int, default=40, help="clips kept per sign; 0 keeps everything")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--balance", type=float, default=0.5)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--signs", default=None, help="optional JSON list of signs to train; omit for all")
    parser.add_argument("--export", action="store_true", help="also export ONNX at the end")
    parser.add_argument("--skip-train", action="store_true", help="convert and merge only")
    args = parser.parse_args()

    source, meta, landmarks = find_input(args.input_root)
    print(f"input {source} | {sum(len(files) for _, _, files in os.walk(landmarks))} files")
    cache = os.path.join(args.out_root, "cache")
    run_dir = os.path.join(args.out_root, "run")
    os.makedirs(cache, exist_ok=True)

    print("== layout check ==", flush=True)
    run("import_islr.py", "--landmarks", landmarks, "--meta", meta, "--out", cache, "--check")

    print("== convert ==", flush=True)
    convert = ["--landmarks", landmarks, "--meta", meta, "--out", cache]
    if args.per_class:
        convert += ["--max-per-class", args.per_class]
    run("import_islr.py", *convert)

    print("== merge into cache ==", flush=True)
    # --init seeds an empty cache, so this works whether or not a PopSign cache was also copied in.
    run("merge_cache.py", "--cache", cache, "--add", "islr", "--init")

    if args.skip_train:
        print("stopping before training as asked; cache at", cache)
        return

    print("== train ==", flush=True)
    vocabulary = args.signs or os.path.join(os.path.dirname(HERE), "vocabulary", "popsign_signs.json")
    if not os.path.exists(vocabulary):
        vocabulary = "-"  # train.py treats a missing file as an empty vocabulary
    train_args = ["--cache", cache, "--out", run_dir, "--epochs", args.epochs, "--bs", args.batch,
                  "--balance", args.balance, "--device", args.device]
    if os.path.exists(vocabulary):
        train_args += ["--vocabulary", vocabulary]
    run("train.py", *train_args)

    log_path = os.path.join(run_dir, "log.jsonl")
    if os.path.exists(log_path):
        epochs = [json.loads(line) for line in open(log_path) if line.strip()]
        if epochs:
            best = max(epochs, key=lambda record: record.get("val_top1") or 0)
            print(f"\nbest epoch {best['epoch']}: val top-1 {best['val_top1']:.3f}, "
                  f"top-5 {best['val_top5']:.3f} over {best['val_n']} clips")

    if args.export:
        print("== export ==", flush=True)
        code = run("export_onnx.py", "--run", run_dir, "--out", os.path.join(args.out_root, "onnx"), check=False)
        if code:
            print("export step failed; the checkpoint is still in", run_dir)

    print("\nartifacts:", args.out_root)
    print("  cache/   merged landmark cache (can be downloaded and reused on a laptop)")
    print("  run/     ckpt.pt, best.pt, classes.json, log.jsonl")
    print("\nA candidate is not shipped until it beats the current model on the signer's own clips:")
    print("  node scripts/diagnostics/replay-live-clip.mjs <clip.json> --label PLEASE")


if __name__ == "__main__":
    main()
