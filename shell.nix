#!/usr/bin/env nix-shell
{pkgs?import<nixpkgs>{}}: let

  sh = name: nativeBuildInputs: opts: pkgs.mkShell ({ inherit name nativeBuildInputs; } // opts);

in sh "fadroma-simplicityhl" [

  pkgs.just
  pkgs.podman
  pkgs.deno
  pkgs.cloc

  # These tools are here for convenience. However,
  # depending on system internals, they are likely
  # to produce an incompatible version of the main
  # WASM build artifact. Therefore, you are advised
  # to build in the provided container - see README.
  pkgs.bacon
  pkgs.binaryen
  pkgs.lld
  pkgs.python3
  pkgs.rustup

] {

  # Used by Justfile.
  DOCKER = "podman";

}
