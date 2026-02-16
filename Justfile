#!/usr/bin/env -S just -f
set export

# Allow using docker or podman to build and run things:
DOCKER  := env("DOCKER", "docker") + " "
BUILDER := "time " + DOCKER
BUILD   := BUILDER + " build "
RUN     := BUILDER + "run --rm -it"
TTY     := RUN     + ""

# Rebuild in debug mode and test
iterate:
  just build-debug
  just test

# Rebuild in release mode and test
release:
  just build-debug
  just test

# List tasks
list:
  @just --list

# Show dependency tree
tree:
  cargo tree --color=always --target=build32-unknown-unknown

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
  @just build-img
  @just test-img

# Build the container image in which WASMs are compiled.
build-img:
  ${BUILD} --target wasm -t "${IMG_WASM}" .

# Build the test image.
test-img:
  ${BUILD} --target test -t "${IMG_TEST}" .

# Wasm container:
IMG_WASM := "hackbg/fadroma-simplicity:build"
VOL_WASM := " -v .:/build:rw "
RUN_WASM := RUN + VOL_WASM + IMG_WASM
TTY_WASM := TTY + VOL_WASM + IMG_WASM

# wasm-pack invocation
WASM_PACK := "time wasm-pack build --target web"

# Remove redundant files from build dir:
WASM_PKG := "rm -v pkg/package.json pkg/.gitignore pkg/README.md"

# Open Bacon TUI to iterate on WASM modules in container.
bacon:
  @just build-img
  ${TTY_WASM} "bacon -s"

# Compile dev build of WASM module in container.
build-debug:
  @just build-img
  ${RUN_WASM} "just build-wasm-debug"

# Compile release build of WASM module in container.
build-release:
  @just build-img
  ${RUN_WASM} "just build-wasm-release"

# Build in dev mode (with stack trace)
build-wasm-debug:
  ${WASM_PACK} --debug --no-opt
  ${WASM_PKG}
  @just build-inspect

# Build in release mode (with optimizations)
build-wasm-release:
  ${WASM_PACK} --release
  ${WASM_PKG}
  @just build-inspect

# Open WASM build shell to iterate on WASM modules in container.
build-sh:
  ${TTY_WASM}

# Show imports and exports of built module
build-inspect:
  wasm2wat pkg/fadroma_simf_bg.wasm | grep import
  wasm2wat pkg/fadroma_simf_bg.wasm | grep export

# Test container:
IMG_TEST := "hackbg/fadroma-simplicity:test"
VOL_TEST := " -v .:/fadroma/platform/SimplicityHL:rw "
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
