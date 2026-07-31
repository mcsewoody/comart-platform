from __future__ import annotations

import argparse
import os
import socket
import sys

from cpf_worker.processor import JobProcessor
from cpf_worker.repository import Repository
from cpf_worker.settings import Settings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=3)
    args = parser.parse_args()
    settings = Settings.from_env()
    repository = Repository(settings)
    worker_id = os.getenv(
        "CPF_WORKER_ID", f"github-{socket.gethostname()}-{os.getpid()}"
    )
    jobs = repository.claim_jobs(worker_id, args.limit)
    failures = 0
    for job in jobs:
        try:
            JobProcessor(settings, repository).process(job, worker_id)
        except Exception as error:
            failures += 1
            print(f"Job {job['id']} failed: {error}", file=sys.stderr)
    print(f"claimed={len(jobs)} failures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
