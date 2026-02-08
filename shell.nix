#!/usr/bin/env nix-shell
{pkgs?import<nixpkgs>{}}: let
  sh = name: nativeBuildInputs: opts: pkgs.mkShell ({ inherit name nativeBuildInputs; } // opts);
in sh "fadroma-simf" [
  pkgs.lld
  pkgs.cloc
  pkgs.binaryen
  pkgs.python3
  pkgs.bacon
  pkgs.rustup
] {}
