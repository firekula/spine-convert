/**
 * 官方编辑器严格兼容性回归测试 —— 覆盖真实用户报错场景：
 *
 * 【用户案例】3.6 JSON（有 images、无 audio）→ 4.2 二进制，Spine 4.2.22 导入报：
 *   "Error at byte: 51 / [npe] Cannot invoke String.isEmpty() because <local3>.F is null"
 *  根因：官方 Java 读取器对 imagesPath/audioPath/hash 调用 isEmpty()，null 直接 NPE。
 *
 * 测试项：
 * 1. 全版本二进制头部严格校验（hash/version/imagesPath/audioPath 不允许 null 字节 0x00）
 * 2. 用户案例字节级复现（offset 40-51 区域逐字节断言）
 * 3. 版本串自定义（4.0+ 编辑器要求主次版本完全一致）
 * 4. 混合逐值曲线的贝塞尔计数精确性（官方 Java 按计数预分配，低报会越界）
 * 5. 空默认皮肤的 4.x deform 皮肤索引正确性
 * 6. 转换产物可被自身读取器完整回读且结构等价
 */
import { readBinary } from '../src/lib/spine/binReader';
import { readJson } from '../src/lib/spine/jsonReader';
import { writeBinary } from '../src/lib/spine/binWriter';
import { convert } from '../src/lib/spine/convert';
import { ALL_VERSIONS, PROFILES } from '../src/lib/spine/spec';
import type { SpineVersion, SkeletonIR } from '../src/lib/spine/types';
import * as fs from 'fs';
import * as path from 'path';

/* bun 的 import.meta.dir（tsc 无此类型，断言绕过） */
const BASE = path.resolve((import.meta as any).dir, '../research/spine');
const G36 = `${BASE}/branch-3.6/spine-runtimes-3.6/examples/goblins/export/goblins-pro.json`;
const SB42_SKEL = `${BASE}/branch-4.2/spine-runtimes-4.2/examples/spineboy/export/spineboy-pro.skel`;

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); failures.push(name); }
}

function toAb(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/* ---------- 1. 用户案例：3.6 JSON（无 audio）→ 4.2 二进制，字节级校验 ---------- */
console.log('\n===== 用户案例：3.6 JSON → 4.2 二进制（NPE 字节 51 复现）=====');
{
  const jsonText = fs.readFileSync(G36, 'utf-8');
  const parsed = JSON.parse(jsonText);
  check('3.6 源 JSON 确实无 audio 字段（复现前提）', parsed.skeleton.audio == null && parsed.skeleton.images != null,
    JSON.stringify(parsed.skeleton));

  const ab = new TextEncoder().encode(jsonText).buffer as ArrayBuffer;
  const res = convert(ab, 'goblins-pro.json', { targetVersion: '4.2', targetFormat: 'binary' });
  check('转换 3.6→4.2 (binary) 成功', res.ok && !!res.output, res.error);

  if (res.ok && res.output && typeof res.output.data !== 'string') {
    const bin = res.output.data as Uint8Array;
    const ir = readBinary(toAb(bin), '4.2');
    check('产物可完整回读（骨骼/动画齐全）', ir.bones.length > 0 && ir.animations.length > 0,
      `bones=${ir.bones.length} anims=${ir.animations.length}`);
    check('imagesPath 非空（原样保留 ./images/）', ir.imagesPath === './images/', JSON.stringify(ir.imagesPath));
    check('audioPath 非 null（官方 isEmpty() 容忍 ""，不容忍 null）', ir.audioPath === '' || ir.audioPath === null && false,
      JSON.stringify(ir.audioPath));

    /* 字节级：头部布局逐字节断言
     * [0..7] hash(8B) [8..14] "4.2.22"(1+6) [15..22] x,y [23..26] w [27..30] h
     * [31..34] refScale [35] nonessential=1 [36..39] fps=30.0f
     * [40..49] imagesPath "./images/"（varint 10 + 9 字符）
     * [50] audioPath —— 必须是 0x01（空串），0x00（null）会让官方编辑器在字节 51 处 NPE */
    check('字节 50：audioPath 编码为空串 0x01 而非 null 0x00', bin[50] === 0x01,
      `实际 0x${bin[50].toString(16)}（0x00 = null = 官方 NPE 触发点）`);
    check('字节 40：imagesPath 长度前缀 varint(10)', bin[40] === 10,
      `实际 ${bin[40]}`);
    const img = new TextDecoder().decode(bin.subarray(41, 50));
    check('字节 41-49：imagesPath 内容 "./images/"', img === './images/', img);
  }
}

/* ---------- 2. 全版本二进制头部严格校验（官方 Java null 不容忍点全查） ---------- */
console.log('\n===== 全版本头部严格校验（3.4~4.2 × json/bin 源）=====');
{
  const sources: { label: string; file: string; ver: SpineVersion }[] = [
    { label: 'goblins 3.6 JSON', file: G36, ver: '3.6' },
    { label: 'spineboy 4.2 skel', file: SB42_SKEL, ver: '4.2' },
  ];
  for (const src of sources) {
    const buf = fs.readFileSync(src.file);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    for (const target of ALL_VERSIONS) {
      const res = convert(ab, src.file, { targetVersion: target, targetFormat: 'binary' });
      if (!res.ok || !res.output || typeof res.output.data === 'string') {
        check(`头部校验 ${src.label} → ${target}`, false, res.error ?? '无输出');
        continue;
      }
      const bin = res.output.data as Uint8Array;
      const P = PROFILES[target];
      try {
        const ir = readBinary(toAb(bin), target);
        const problems: string[] = [];
        /* 官方 Java 读取器对以下字段调用 isEmpty()，文件中写成 null(0x00) 会直接 NPE */
        if (!P.bin.hashAsLong && ir.hash == null) problems.push('hash 为 null');
        if (ir.version == null || ir.version === '') problems.push('version 为空');
        if (ir.imagesPath == null) problems.push('imagesPath 为 null');
        if (P.bin.hasAudioPath && ir.audioPath == null) problems.push('audioPath 为 null');
        check(`头部校验 ${src.label} → ${target} (${bin.length}B)`, problems.length === 0, problems.join('、'));
      } catch (e) {
        check(`头部校验 ${src.label} → ${target}`, false, (e as Error).message);
      }
    }
  }
}

/* ---------- 3. 版本串自定义 ---------- */
console.log('\n===== 版本串自定义（4.0+ 精确版本匹配）=====');
{
  const buf = fs.readFileSync(G36);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  const r1 = convert(ab, 'g.json', { targetVersion: '4.2', targetFormat: 'binary', versionString: '4.2.45' });
  check('自定义 4.2.45 转换成功', r1.ok, r1.error);
  if (r1.ok && r1.output && typeof r1.output.data !== 'string') {
    const ir = readBinary(toAb(r1.output.data as Uint8Array), '4.2');
    check('二进制内版本串 = 4.2.45', ir.version === '4.2.45', ir.version);
  }

  const r2 = convert(ab, 'g.json', { targetVersion: '4.1', targetFormat: 'json', versionString: '4.1.03' });
  check('自定义 4.1.03 JSON 转换成功', r2.ok, r2.error);
  if (r2.ok && r2.output) {
    const j = JSON.parse(r2.output.data as string);
    check('JSON 内版本串 = 4.1.03', j.skeleton.spine === '4.1.03', j.skeleton.spine);
  }

  const r3 = convert(ab, 'g.json', { targetVersion: '4.2', targetFormat: 'binary', versionString: '4.1.00' });
  check('主次版本不一致被拒绝', !r3.ok && /不一致/.test(r3.error ?? ''), r3.error);

  const r4 = convert(ab, 'g.json', { targetVersion: '4.2', targetFormat: 'binary', versionString: 'garbage' });
  check('非法格式版本串被拒绝', !r4.ok && /格式无效/.test(r4.error ?? ''), r4.error);

  const r5 = convert(ab, 'g.json', { targetVersion: '3.7', targetFormat: 'binary' });
  check('默认版本串（3.7 → 3.7.94）', r5.ok
    && (() => { if (!r5.output || typeof r5.output.data === 'string') return false; const ir = readBinary(toAb(r5.output.data as Uint8Array), '3.7'); return ir.version === '3.7.94'; })());
}

/* ---------- 4. 混合逐值曲线的贝塞尔计数精确性 ---------- */
console.log('\n===== 贝塞尔计数精确性（官方 Java 预分配，低报越界）=====');
{
  /* 构造含混合曲线的 IR：translate 时间轴 value0=x 为贝塞尔、value1=y 为 linear ——
   * 二进制段编码为 byte=2 + 2 组控制点，计数必须为 2（而非旧的 1） */
  const ir: SkeletonIR = {
    hash: null, version: '4.2.22', x: 0, y: 0, width: 100, height: 100, fps: 30,
    imagesPath: null, audioPath: null, referenceScale: 100, curveSpace: 'abs',
    bones: [
      { name: 'root', parent: null, length: 10, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, transformMode: 'normal' },
      { name: 'b1', parent: 'root', length: 10, rotation: 0, x: 5, y: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, transformMode: 'normal' },
    ],
    slots: [{ name: 's1', bone: 'root', color: 'ffffffff', blend: 'normal' }],
    ik: [], transform: [], path: [], physics: [],
    defaultSkin: null, skins: [], events: [], animations: [],
  };
  ir.animations.push({
    name: 'mixed',
    bone: {
      b1: {
        translate: [
          { time: 0, x: 0, y: 0, curves: [{ bezier: [0.1, 0.5, 0.3, 1] }, null] },   // x 贝塞尔 + y linear（混合！）
          { time: 1, x: 10, y: 5, curves: [{ bezier: [1.2, 4, 1.6, 5] }, { stepped: true }] }, // x 贝塞尔 + y stepped（混合！）
          { time: 2, x: 20, y: 8 },
        ],
      },
    },
    slot: {}, ik: {}, transform: {}, path: {}, physics: {},
    deform: {}, sequence: {}, drawOrder: [], events: [],
  });

  const bin = writeBinary(ir, '4.2', { nonessential: true });
  const back = readBinary(toAb(bin), '4.2');
  check('混合曲线二进制可回读', back.animations.length === 1 && !!back.animations[0].bone.b1?.translate);
  const keys = back.animations[0].bone.b1!.translate!;
  check('混合曲线 x 分量贝塞尔保留', keys[0].curves?.[0] != null && 'bezier' in (keys[0].curves![0] as object),
    JSON.stringify(keys[0].curves));
  check('混合曲线 y 分量以等价贝塞尔占位（非 null 段）', keys[0].curves?.[1] != null,
    JSON.stringify(keys[0].curves));

  /* 精确校验：手工解析二进制里的骨骼时间轴段，提取 bezierCount 并与实际消耗一致 */
  /* 布局：动画名 → 总时间轴数 → 槽数(0) → 骨骼数(1) → boneIdx(1) → tl数(1) → type(1=translate)
   * → frameCount(3) → bezierCount → [t0 x0 y0][t1 x1 y1 curve0][t2 x2 y2 curve1] */
  /* 用读取器直接验证：重建后的曲线行为等价（y linear 的占位贝塞尔应为三分点控制点） */
  const yCurve = keys[0].curves![1] as { bezier: number[] };
  if (yCurve && 'bezier' in yCurve) {
    const [cx1, cy1, cx2, cy2] = yCurve.bezier;
    /* 段 (0,0)→(1,5)：linear 等价贝塞尔 = 三分点 (1/3, 5/3) 与 (2/3, 10/3) */
    check('linear 占位贝塞尔为三分点控制点（非 S 形端点）',
      Math.abs(cx1 - 1 / 3) < 1e-4 && Math.abs(cy1 - 5 / 3) < 1e-4
      && Math.abs(cx2 - 2 / 3) < 1e-4 && Math.abs(cy2 - 10 / 3) < 1e-4,
      `实际 [${cx1},${cy1},${cx2},${cy2}]`);
  } else {
    check('linear 占位贝塞尔为三分点控制点', false, 'y 曲线未按贝塞尔占位写出');
  }
  const yCurve2 = keys[1].curves![1] as { bezier: number[] } | { stepped: true } | null;
  /* 第二段（t=1,y=5 → t=2,y=8）y 是 stepped → 占位应为阶梯贝塞尔：控制点 (t_end, v0) → (t_end, v1) = (2,5,2,8) */
  if (yCurve2 && 'bezier' in yCurve2) {
    const [cx1, cy1, cx2, cy2] = yCurve2.bezier;
    check('stepped 占位贝塞尔为阶梯控制点',
      Math.abs(cx1 - 2) < 1e-4 && Math.abs(cy1 - 5) < 1e-4 && Math.abs(cx2 - 2) < 1e-4 && Math.abs(cy2 - 8) < 1e-4,
      `实际 [${cx1},${cy1},${cx2},${cy2}]`);
  } else {
    check('stepped 占位贝塞尔为阶梯控制点', false, JSON.stringify(yCurve2));
  }

  /* 混合曲线 + IK 时间轴（4.2 flags 版）：mix 贝塞尔 + softness linear */
  ir.ik.push({
    name: 'ik1', order: 0, skinRequired: false, bones: ['b1'], target: 'root',
    mix: 1, softness: 0, bendDirection: 1, compress: false, stretch: false, uniform: false,
  });
  ir.animations[0].ik = {
    ik1: [
      { time: 0, mix: 0, softness: 0, bendDirection: 1, compress: false, stretch: false, curves: [{ bezier: [0.1, 0.2, 0.3, 0.4] }, null] },
      { time: 1, mix: 1, softness: 2, bendDirection: 1, compress: false, stretch: false },
    ],
  };
  const bin2 = writeBinary(ir, '4.2', { nonessential: true });
  const back2 = readBinary(toAb(bin2), '4.2');
  check('混合曲线 IK(4.2) 可回读', (back2.animations[0].ik.ik1?.length ?? 0) === 2);
  const ikKeys = back2.animations[0].ik.ik1!;
  check('IK 混合曲线 softness 占位为三分点贝塞尔',
    ikKeys[0].curves?.[1] != null && 'bezier' in (ikKeys[0].curves![1] as object),
    JSON.stringify(ikKeys[0].curves));
}

/* ---------- 5. 空默认皮肤的 4.x deform 皮肤索引 ---------- */
console.log('\n===== 空默认皮肤 → 4.x deform 皮肤索引 =====');
{
  /* goblins 3.6 有 default 皮肤条目；这里构造“默认皮肤为空、只有具名皮肤”的场景 */
  const jsonText = fs.readFileSync(G36, 'utf-8');
  const parsed = JSON.parse(jsonText);
  /* 把 default 皮肤条目清空（模拟只有 defaultSkin 元数据而无条目的骨架） */
  if (parsed.skins.default) {
    const named = Object.keys(parsed.skins).filter((k) => k !== 'default');
    if (named.length > 0) {
      /* 将 default 条目并入第一个具名皮肤不算 —— 直接删除 default 节 */
      const moved = parsed.skins.default;
      delete parsed.skins.default;
      const first = parsed.skins[named[0]];
      for (const [slot, atts] of Object.entries(moved)) Object.assign(first[slot] ??= {}, atts);
    }
  }
  const ab = new TextEncoder().encode(JSON.stringify(parsed)).buffer as ArrayBuffer;
  for (const target of ['4.0', '4.1', '4.2'] as SpineVersion[]) {
    const res = convert(ab, 'no-default.json', { targetVersion: target, targetFormat: 'binary' });
    if (!res.ok || !res.output || typeof res.output.data === 'string') {
      check(`空默认皮肤 → ${target}`, false, res.error);
      continue;
    }
    try {
      const back = readBinary(toAb(res.output.data as Uint8Array), target);
      /* 皮肤索引错位时：deform 时间轴会指向不存在的皮肤 → 动画丢失或异常。
       * 校验：具名皮肤存在，动画数量与源一致 */
      const src = readJson(JSON.stringify(parsed), '3.6');
      check(`空默认皮肤 → ${target}（皮肤与动画保留）`,
        back.skins.length === src.skins.length && back.animations.length === src.animations.length,
        `skins ${back.skins.length}/${src.skins.length} anims ${back.animations.length}/${src.animations.length}`);
    } catch (e) {
      check(`空默认皮肤 → ${target}`, false, (e as Error).message);
    }
  }
}

/* ---------- 6. 3.6 JSON → 全部 4.x 二进制再回读对比 ---------- */
console.log('\n===== 3.6 JSON → 4.x 二进制产物结构对比 =====');
{
  const jsonText = fs.readFileSync(G36, 'utf-8');
  const src = readJson(jsonText, '3.6');
  const ab = new TextEncoder().encode(jsonText).buffer as ArrayBuffer;
  for (const target of ['4.0', '4.1', '4.2'] as SpineVersion[]) {
    const res = convert(ab, 'goblins-pro.json', { targetVersion: target, targetFormat: 'binary' });
    if (!res.ok || !res.output || typeof res.output.data === 'string') {
      check(`结构对比 → ${target}`, false, res.error);
      continue;
    }
    const back = readBinary(toAb(res.output.data as Uint8Array), target);
    const bones = back.bones.length === src.bones.length;
    const slots = back.slots.length === src.slots.length;
    const anims = back.animations.length === src.animations.length;
    const animNames = back.animations.every((a, i) => a.name === src.animations[i].name);
    check(`3.6 → ${target} 二进制结构等价`, bones && slots && anims && animNames,
      `bones ${back.bones.length}/${src.bones.length} slots ${back.slots.length}/${src.slots.length} anims ${back.animations.length}/${src.animations.length}`);
    /* 3.6 JSON 有 mesh + linkedmesh（goblins）→ 校验附件类型保留 */
    const meshCount = (s: SkeletonIR) => [s.defaultSkin, ...s.skins].filter(Boolean)
      .reduce((n, sk) => n + sk!.entries.filter((e) => e.attachment.type === 'mesh' || e.attachment.type === 'linkedmesh').length, 0);
    check(`3.6 → ${target} mesh/linkedmesh 附件保留`, meshCount(back) === meshCount(src),
      `${meshCount(back)}/${meshCount(src)}`);
  }
}

console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
if (failures.length) {
  console.log('\n失败清单：');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
