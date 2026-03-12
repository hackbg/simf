# **Build image**. Provides predictable environment for compiling the WASM blob.
FROM docker.io/library/rust:1.92-trixie AS wasm
RUN rustup target add wasm32-unknown-unknown
RUN apt update && apt install -yy clang wabt emscripten just time curl
ARG BINARYEN="https://github.com/WebAssembly/binaryen/releases/download/version_125/binaryen-version_125-x86_64-linux.tar.gz"
RUN cd /usr/local && curl -Lf "${BINARYEN}" | tar --strip-components=1 -xz
RUN cargo install wasm-pack bacon
WORKDIR /build
ENTRYPOINT [ "/usr/bin/bash", "-c" ]

# **Test image**. Provides predictable environment for running test suite.
FROM denoland/deno:2.6.6 as test
RUN apt update && apt install -yy curl just git
# This provides the `elementsd` for running temporary localnets.
ARG ELEMENTS="https://github.com/ElementsProject/elements/releases/download/elements-23.3.1/elements-23.3.1-x86_64-linux-gnu.tar.gz"
RUN cd /usr/local && curl -Lf "${ELEMENTS}" | tar --strip-components=1 -xz
# This draws the rest of the owl.
ARG FADROMA_REF="3a3d510b63"
ARG FADROMA_URL="https://github.com/hackbg/fadroma"
RUN git clone --progress -b v3-alpha "${FADROMA_URL}" /fadroma && cd /fadroma && git checkout "${FADROMA_REF}"
WORKDIR /fadroma
ENTRYPOINT [ "/usr/bin/bash", "-c" ]
