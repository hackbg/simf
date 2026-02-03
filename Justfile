#!/usr/bin/env -S just -f
set export
JUST  := "time just"
BUILD := "time podman build"
IMAGE := "hackbg/fadroma:build-wasm"
RUN   := "time podman run --rm -v .:/app:rw --workdir=/app -it"
# List tasks
list:
  @just --list
# Compile build image in which WASMs are compiled.
wasm-img:
  ${BUILD} -t "${IMAGE}" .
# Open WASM build shell to iterate on WASM modules.
wasm-sh:
  ${RUN} ${IMAGE}
# Compile dev build of WASM~ module.
wasm:
  ${JUST} wasm-img
  ${RUN} ${IMAGE} sh -c "just build"
# Build in dev mode (with stack trace)
build:
  time wasm-pack build --debug --no-opt --target web
  rm -v pkg/package.json pkg/.gitignore
  @just inspect
# Build in release mode (with optimizations)
build-release:
  time wasm-pack build --release --target web
  rm -v pkg/package.json pkg/.gitignore
  @just inspect
# Show imports and exports of built module
inspect:
  wasm2wat pkg/fadroma_simf_bg.wasm | grep import
  wasm2wat pkg/fadroma_simf_bg.wasm | grep export
# Show dependency tree
tree:
  cargo tree --color=always --target=wasm32-unknown-unknown
# Report line counts.
cloc:
  cloc \
    --not-match-d=node_modules \
    --not-match-d=target \
    --not-match-d=dist \
    --not-match-d=deps \
    --not-match-d=.misc \
    --not-match-d=.docs \
    --not-match-d=.deno \
    --not-match-d=coverage \
    .
