#!/bin/bash
# 下载 spine-runtimes 各分支 tarball，仅提取 examples 的 json/skel 导出文件
set -u
DEST=/home/z/my-project/research/spine
mkdir -p "$DEST"

fetch_branch() {
  local ref="$1" name="$2"
  local tar="$DEST/$name.tar.gz"
  local out="$DEST/branch-$name"
  if [ -d "$out/examples" ]; then echo "== $name 已提取"; return 0; fi
  echo "== 下载 $ref ..."
  curl -s --connect-timeout 20 --max-time 500 -o "$tar" "https://codeload.github.com/EsotericSoftware/spine-runtimes/tar.gz/$ref" || { echo "下载失败"; return 1; }
  local sz=$(wc -c < "$tar")
  echo "   tarball: $sz bytes"
  mkdir -p "$out"
  # 仅提取 examples 下的 .json/.skel/.atlas（跳过图片与源码）
  tar xzf "$tar" -C "$out" --wildcards \
    '*/examples/*/export/*.json' '*/examples/*/export/*.skel' '*/examples/*/export/*.atlas' 2>/dev/null || echo "   (提取模式无匹配或部分失败)"
  rm -f "$tar"
  echo "== $name 提取结果:"
  find "$out" -type f \( -name '*.json' -o -name '*.skel' \) | wc -l
}

fetch_branch "refs/heads/3.8" 3.8
fetch_branch "refs/heads/4.2" 4.2
fetch_branch "refs/heads/3.6" 3.6
fetch_branch "refs/heads/4.0" 4.0

echo "---- 汇总 ----"
for d in "$DEST"/branch-*; do
  echo "$d: $(find $d -name '*.skel' | wc -l) skel, $(find $d -name '*.json' | wc -l) json"
done