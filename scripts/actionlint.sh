#!/usr/bin/env bash
set -euo pipefail

readonly actionlint_image="rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667"
shopt -s nullglob
workflow_files=(.github/workflows/*.yml .github/workflows/*.yaml)

if ((${#workflow_files[@]} == 0)); then
  echo "No GitHub Actions workflows found." >&2
  exit 1
fi

container_files=()
for workflow_file in "${workflow_files[@]}"; do
  container_files+=("/repo/${workflow_file}")
done

exec docker run --rm \
  --mount "type=bind,source=${PWD}/.github/workflows,target=/repo/.github/workflows,readonly" \
  --workdir /repo \
  "${actionlint_image}" \
  -color \
  "${container_files[@]}"
