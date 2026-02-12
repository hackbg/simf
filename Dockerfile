# **Build image**. Provides predictable environment for compiling the WASM blob.
#
# Otherwise, compatibility issues may be encountered, as indicated by
# multiple missing "env" imports in the WASM's ABI.
#
# Ostensibly, the incompatibility is between the Clang version that was
# used to build the Rust compiler being used, vs. the Clang version that
# is currently available on the system (which compiles the jets from C).
FROM docker.io/library/rust:1.92-trixie AS wasm-builder
RUN rustup target add wasm32-unknown-unknown
RUN apt update && apt install -yy clang wabt emscripten just time curl
ARG BINARYEN="https://github.com/WebAssembly/binaryen/releases/download/version_125/binaryen-version_125-x86_64-linux.tar.gz"
RUN cd /usr/local && curl -Lf "${BINARYEN}" | tar --strip-components=1 -xz
RUN cargo install wasm-pack bacon

# **Test image**. Provides predictable environment for running test suite.
#
# This repository started out as a directory in the Fadroma v3 monorepo.
# As some of its dependencies are still not officially published,
# this image clones a pinned commit of Fadroma and
# Running the SDK's test suite
FROM denoland/deno:2.6.6 as test-deno
RUN apt update && apt install -yy curl just git
# This provides the `elementsd` for running temporary localnets.
ARG ELEMENTS="https://github.com/ElementsProject/elements/releases/download/elements-23.3.1/elements-23.3.1-x86_64-linux-gnu.tar.gz"
RUN cd /usr/local && curl -Lf "${ELEMENTS}" | tar --strip-components=1 -xz
# This draws the rest of the owl.
ARG FADROMA_REF="cc093ca98101200ab680da4226a417615ebf3381"
ARG FADROMA_URL="https://github.com/hackbg/fadroma"
RUN git clone --progress -b v3-alpha "${FADROMA_URL}" /test && cd /test && git checkout "${FADROMA_REF}"
WORKDIR /test
