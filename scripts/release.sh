#!/usr/bin/env bash
# Bump version (commit + tag), push, publish GitHub Release → triggers docker.yml.
# Usage: pnpm release [patch|minor|major|x.y.z]   (default: patch)
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm version "${1:-patch}"   # bumps package.json, commits, tags vX.Y.Z (refuses if tree is dirty)
git push --follow-tags
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
