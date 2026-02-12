#!/usr/bin/env -S just -f
set export

# Allow using docker or podman to build and run things:
DOCKER  := env("DOCKER", "docker") + " "
BUILDER := "time " + DOCKER
BUILD   := BUILDER + " build "
RUN     := BUILDER + "run --rm"
TTY     := RUN     + "-it "

# List tasks
list:
  @just --list

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

# Build development container images:
img:
  @just wasm-img
  @just test-img

# Build the container image in which WASMs are compiled.
wasm-img:
  ${BUILD} --target wasm -t "${IMG_WASM}" .

# Build the test image.
test-img:
  ${BUILD} --target test -t "${IMG_TEST}" .

# Wasm container:
IMG_WASM := "hackbg/fadroma-simplicity:wasm"
VOL_WASM := " -v .:/build:rw "
RUN_WASM := RUN + VOL_WASM + IMG_WASM
TTY_WASM := TTY + VOL_WASM + IMG_WASM

# wasm-pack invocation
WASM_PACK := "time wasm-pack build --target web"

# Remove redundant files from build dir:
WASM_PKG := "rm -v pkg/package.json pkg/.gitignore pkg/README.md"

# Compile dev build of WASM module in container.
wasm:
  @just wasm-img
  ${RUN_WASM} "just build"

# Compile release build of WASM module in container.
wasm-release:
  @just wasm-img
  ${RUN_WASM} "just build-release"

# Open Bacon TUI to iterate on WASM modules in container.
wasm-bacon:
  @just wasm-img
  ${TTY_WASM} "just bacon"

# Open WASM build shell to iterate on WASM modules in container.
wasm-sh:
  ${TTY_WASM}

# Build in dev mode (with stack trace)
build:
  ${WASM_PACK} --debug --no-opt
  ${WASM_PKG}
  @just inspect

# Build in release mode (with optimizations)
build-release:
  ${WASM_PACK} --target web --release
  ${WASM_PKG}
  @just inspect

# Show imports and exports of built module
inspect:
  wasm2wat pkg/fadroma_simf_bg.wasm | grep import
  wasm2wat pkg/fadroma_simf_bg.wasm | grep export

# Test container:
IMG_TEST := "hackbg/fadroma-simplicity:test"
VOL_TEST := " -v .:/test/platform/SimplicityHL:rw "
RUN_TEST := RUN + VOL_TEST + IMG_TEST
TTY_TEST := TTY + VOL_TEST + IMG_TEST

# Open test shell to iterate on WASM module wrapper in container.
test-sh:
  @just test-img
  ${TTY_TEST}

# Run tests in container.
test:
  @just test-img
  ${RUN_TEST} "cd platform/SimplicityHL/ && ./SimplicityHL.test.ts"
