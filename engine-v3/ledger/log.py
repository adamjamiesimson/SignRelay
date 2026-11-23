"""Append an entry to experiments.jsonl:  python log.py '{"kind": ..., ...}'"""
import json, sys, time, os, platform
e = json.loads(sys.argv[1]); e.setdefault("logged_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
e.setdefault("host", {"cpus": os.cpu_count(), "platform": platform.platform(), "gpu": None})
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "experiments.jsonl"), "a").write(json.dumps(e) + "\n")
