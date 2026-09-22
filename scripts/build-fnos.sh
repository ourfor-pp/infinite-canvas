#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
out="$project_dir/.tmp/fnos"
target="${FNOS_SSH_TARGET:-panpan@192.168.199.218}"
node --test "$project_dir/scripts/fnos-package.test.mjs"
mkdir -p "$out"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o "$out/proxy" "$project_dir/deploy/fnos/proxy.go"
# 私有临时目录中使用官方模板，保留标准安装生命周期，覆盖应用中心和桌面图标。
remote_dir="$(ssh "$target" 'mktemp -d /tmp/infinite-canvas-fpk.XXXXXX')"
trap 'ssh "$target" "rm -rf -- $remote_dir"' EXIT
ssh "$target" "cd '$remote_dir' && fnpack create infinite-canvas"
scp -q -r "$project_dir/deploy/fnos/app" "$project_dir/deploy/fnos/cmd" "$project_dir/deploy/fnos/config" "$project_dir/deploy/fnos/manifest" "$target:$remote_dir/infinite-canvas/"
scp -q "$project_dir/deploy/fnos/ICON.PNG" "$project_dir/deploy/fnos/ICON_256.PNG" "$target:$remote_dir/infinite-canvas/"
scp -q "$out/proxy" "$target:$remote_dir/infinite-canvas/app/"
ssh "$target" "cd '$remote_dir/infinite-canvas' && fnpack build"
scp -q "$target:$remote_dir/infinite-canvas/infinite-canvas.fpk" "$out/infinite-canvas.fpk"
chmod 600 "$out/infinite-canvas.fpk"
echo "安装包：$out/infinite-canvas.fpk"
