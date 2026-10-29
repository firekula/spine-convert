#!/bin/bash
# 从 Maven Central 下载 spine-libgdx 官方运行时源码 jar（Java 版与 TS 版读取相同的文件格式）
set -u
DEST=/home/z/my-project/research/spine
MAVEN=https://repo1.maven.org/maven2/com/esotericsoftware/spine/spine-libgdx

dl_maven() {
  local ver="$1"
  local jar="$DEST/spine-libgdx-$ver-sources.jar"
  if [ -s "$jar" ]; then echo "SKIP $ver"; return 0; fi
  code=$(curl -s --connect-timeout 15 --max-time 120 -w '%{http_code}' -o "$jar" "$MAVEN/$ver/spine-libgdx-$ver-sources.jar")
  echo "$ver sources: $code ($( [ -s "$jar" ] && wc -c < "$jar" || echo 0) bytes)"
}

# 每个大版本取最后一个 patch 版
dl_maven 3.5.51.1
dl_maven 3.6.53.1
dl_maven 3.7.94.1
dl_maven 3.8.99.1
dl_maven 4.0.18.1
dl_maven 4.1.0
dl_maven 4.2.12

# 解压出 SkeletonJson/SkeletonBinary
cd "$DEST"
for jar in spine-libgdx-*-sources.jar; do
  [ -s "$jar" ] || continue
  ver=$(echo "$jar" | sed 's/spine-libgdx-\(.*\)-sources.jar/\1/')
  short=$(echo "$ver" | cut -d. -f1-2)
  mkdir -p "java-$short"
  unzip -o -q "$jar" 'src/com/esotericsoftware/spine/SkeletonJson.java' 'src/com/esotericsoftware/spine/SkeletonBinary.java' -d "java-$short" 2>/dev/null \
    || unzip -o -q "$jar" -d "java-$short"
  echo "== $ver -> java-$short =="
done
echo "---- 结果 ----"
for d in "$DEST"/java-*/; do echo "$d:"; ls -la "$d" 2>/dev/null | head -8; done
