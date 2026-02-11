#!/usr/bin/env nix-shell
{pkgs?import<nixpkgs>{}}: let
  sh = name: nativeBuildInputs: opts: pkgs.mkShell ({ inherit name nativeBuildInputs; } // opts);
in sh "fadroma-simf" [
  pkgs.bacon
  pkgs.binaryen
  pkgs.cloc
  pkgs.deno
  pkgs.lld
  pkgs.python3
  pkgs.rustup
] {}
