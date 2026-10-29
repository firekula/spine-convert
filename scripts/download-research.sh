#!/bin/bash
# 下载 Spine 官方 spine-ts 运行时源码，作为各版本格式规范的权威参考
set -u
DEST=/home/z/my-project/research/spine
mkdir -p "$DEST"/{3.5,3.6,3.7,3.8,4.0,4.1,4.2}

dl() {
  local url="$1" out="$2"
  if [ -s "$out" ]; then echo "SKIP(exists) $(basename $out) $url"; return 0; fi
  code=$(curl -sL --connect-timeout 10 --max-time 60 -w '%{http_code}' -o "$out" "$url")
  if [ "$code" = "200" ] && [ -s "$out" ]; then
    echo "OK   $code $(basename $(dirname $out))/$(basename $out)"
  else
    echo "FAIL $code $url"
    rm -f "$out"
  fi
}

BASE_OLD=https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes
BASE_NEW=https://raw.githubusercontent.com/EsotericSoftware/spine-ts

# 3.x 系列（spine-runtimes 仓库，分支 3.5~3.8）
for v in 3.5 3.6 3.7 3.8; do
  dl "$BASE_OLD/$v/spine-ts/spine-core/src/SkeletonJson.ts"    "$DEST/$v/SkeletonJson.ts"
  dl "$BASE_OLD/$v/spine-ts/spine-core/src/SkeletonBinary.ts"  "$DEST/$v/SkeletonBinary.ts"
done

# 4.x 系列（spine-ts 仓库，分支 4.0/4.1/4.2）
for v in 4.0 4.1 4.2; do
  dl "$BASE_NEW/$v/spine-core/src/SkeletonJson.ts"    "$DEST/$v/SkeletonJson.ts"
  dl "$BASE_NEW/$v/spine-core/src/SkeletonBinary.ts"  "$DEST/$v/SkeletonBinary.ts"
done

echo "---- 文件大小 ----"
for f in "$DEST"/*/*.ts; do
  [ -s "$f" ] && echo "$(wc -c < "$f" | tr -d ' ')  $f"
done
