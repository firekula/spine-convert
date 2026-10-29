/** 逐附件类型合成测试：4.2 / 4.0 / 3.8 各写一次，找出哪个类型写出/读回不对称 */
import { readBinary } from '../src/lib/spine/binReader';
import { writeBinary } from '../src/lib/spine/binWriter';
import type { SpineVersion, SkeletonIR, AttachmentIR, VerticesIR } from '../src/lib/spine/types';
import * as fs from 'fs';
import * as path from 'path';

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

function stripVolatile(ir: SkeletonIR): unknown {
  return JSON.parse(JSON.stringify(ir, (k, v) =>
    ['hash', 'version', 'fps', 'imagesPath', 'audioPath', 'referenceScale', 'curveSpace',
      'icon', 'visible', 'color', 'skinRequired', 'inheritRotation', 'inheritScale'].includes(k) ? undefined : v));
}

function deepEq(a: unknown, b: unknown, tol = 1e-6, trail = ''): { eq: boolean; where: string } {
  if (typeof a === 'number' && typeof b === 'number') {
    return { eq: Math.abs(a - b) <= tol || (isNaN(a) && isNaN(b)), where: `${trail} (${a} vs ${b})` };
  }
  if (a == null && b == null) return { eq: true, where: trail };
  if (typeof a !== typeof b) return { eq: false, where: `${trail} (类型 ${typeof a} vs ${typeof b})` };
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return { eq: false, where: `${trail} (长度 ${a.length} vs ${b.length})` };
    for (let i = 0; i < a.length; i++) { const r = deepEq(a[i], b[i], tol, `${trail}[${i}]`); if (!r.eq) return r; }
    return { eq: true, where: trail };
  }
  if (a != null && b != null && typeof a === 'object') {
    const ka = Object.keys(a).sort().filter((k) => (a as any)[k] !== undefined);
    const kb = Object.keys(b).sort().filter((k) => (b as any)[k] !== undefined);
    if (JSON.stringify(ka) !== JSON.stringify(kb)) {
      const onlyA = ka.filter((k) => !kb.includes(k)), onlyB = kb.filter((k) => !ka.includes(k));
      return { eq: false, where: `${trail} (键差 A+${JSON.stringify(onlyA.slice(0, 4))} B+${JSON.stringify(onlyB.slice(0, 4))})` };
    }
    for (const k of ka) { const r = deepEq((a as any)[k], (b as any)[k], tol, `${trail}.${k}`); if (!r.eq) return r; }
    return { eq: true, where: trail };
  }
  return { eq: a === b, where: `${trail} (${String(a)} vs ${String(b)})` };
}

/* 最小骨架：1 骨骼 1 槽位，默认皮肤放一个附件 */
function makeIr(att: AttachmentIR, attName = 'a'): SkeletonIR {
  return {
    hash: null, version: '', x: 0, y: 0, width: 100, height: 100, fps: 30,
    imagesPath: null, audioPath: null, referenceScale: 100,
    bones: [{ name: 'b0', parent: null, length: 10, rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, transformMode: 'normal' }],
    slots: [{ name: 's0', bone: 'b0', color: 'ffffffff', blend: 'normal', attachment: 'a' }],
    ik: [], transform: [], path: [], physics: [],
    defaultSkin: { name: 'default', bones: [], constraints: { ik: [], transform: [], path: [], physics: [] }, entries: [{ slot: 's0', name: attName, attachment: att }] },
    skins: [], events: [], animations: [],
  };
}

const plainVerts: VerticesIR = { weighted: false, vertices: [1, 2, 3, 4, 5, 6, 7, 8] };
const weightedVerts: VerticesIR = { weighted: true, vertices: [1, 2, 0.5, 3, 4, 0.6], bones: [1, 0, 1, 0] };

const cases: [string, AttachmentIR][] = [
  ['region', { type: 'region', name: 'a', path: 'a', rotation: 30, x: 1, y: 2, scaleX: 1, scaleY: 1, width: 10, height: 20, color: 'ffffffff', sequence: null }],
  ['region+path', { type: 'region', name: 'a', path: 'a.png', rotation: 0, x: 1, y: 2, scaleX: 1, scaleY: 1, width: 10, height: 20, color: 'ffffffff', sequence: null }],
  ['region+seq', { type: 'region', name: 'a', path: 'a', rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, width: 10, height: 20, color: 'ffffffff', sequence: { count: 3, start: 1, digits: 2, setup: 0 } }],
  ['boundingbox', { type: 'boundingbox', name: 'a', verts: plainVerts, color: null }],
  ['boundingbox+w', { type: 'boundingbox', name: 'a', verts: weightedVerts, color: null }],
  ['mesh', { type: 'mesh', name: 'a', path: 'a', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3], verts: plainVerts, hull: 4, edges: null, width: 10, height: 10, color: 'ffffffff', sequence: null }],
  ['mesh+w+hull2', { type: 'mesh', name: 'a', path: 'a', uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5], triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4], verts: { weighted: false, vertices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, hull: 4, edges: [0, 1, 1, 2], width: 10, height: 10, color: 'ffffffff', sequence: null }],
  ['linkedmesh', { type: 'linkedmesh', name: 'a', path: 'a', skin: null, parent: 'pm', deform: true, width: 10, height: 10, color: 'ffffffff', sequence: null }],
  ['path', { type: 'path', name: 'a', closed: true, constantSpeed: false, vertexCount: 3, verts: { weighted: true, vertices: [1, 2, 0.5, 3, 4, 0.6, 5, 6, 0.5, 7, 8, 0.6, 9, 10, 0.5, 11, 12, 0.6], bones: [2, 0, 1, 2, 0, 1, 2, 0, 1] }, lengths: [1.5], color: null }],
  ['point', { type: 'point', name: 'a', rotation: 45, x: 1, y: 2, color: null }],
  ['clipping', { type: 'clipping', name: 'a', end: 's0', vertexCount: 4, verts: plainVerts, color: null }],
];

for (const ver of ['3.6', '3.8', '4.0', '4.1', '4.2'] as SpineVersion[]) {
  console.log(`\n===== 目标版本 ${ver} =====`);
  for (const [label, att] of cases) {
    /* 序列帧为 4.1+ 特性：低版本目标会丢弃（预期降级），跳过对比 */
    if (label.endsWith('+seq') && ver !== '4.1' && ver !== '4.2') { console.log(`  ⏭️ ${label}（${ver} 不支持序列帧，预期丢弃）`); continue; }
    const ir = makeIr(clone(att));
    try {
      const bin = writeBinary(ir, ver, { nonessential: true });
      const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
      const back = readBinary(ab, ver);
      const r = deepEq(stripVolatile(ir), stripVolatile(back));
      console.log(`  ${r.eq ? '✅' : '❌'} ${label}${r.eq ? '' : ': ' + r.where}`);
    } catch (e) {
      console.log(`  💥 ${label}: ${(e as Error).message}`);
    }
  }
}

/* 各官方文件 defaultSkin 附件类型清单 */
console.log('\n===== 官方文件 defaultSkin 条目类型 =====');
for (const [ver, rel] of [['4.0', 'branch-4.0/spine-runtimes-4.0/examples/spineboy/export/spineboy-pro.skel'], ['4.2', 'branch-4.2/spine-runtimes-4.2/examples/spineboy/export/spineboy-pro.skel'], ['4.2', 'branch-4.2/spine-runtimes-4.2/examples/tank/export/tank-pro.skel'], ['4.2', 'branch-4.2/spine-runtimes-4.2/examples/raptor/export/raptor-pro.skel']] as [SpineVersion, string][]) {
  const buf = fs.readFileSync(path.resolve((import.meta as any).dir, '../research/spine', rel));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const ir = readBinary(ab, ver);
  const types = (ir.defaultSkin?.entries ?? []).map((e) => `${e.slot}:${e.name}(${e.attachment.type}${e.attachment.type === 'linkedmesh' ? '/skin=' + (e.attachment as any).skin : ''})`);
  console.log(`${rel.split('/').pop()} [${ver}]: ${types.join(', ')}`);
}
