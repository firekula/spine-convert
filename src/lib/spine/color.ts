/** 颜色与曲线工具 */
import type { Curve } from './types';

/** 解析 hex 颜色 → [r,g,b,a] (0-255)。支持 RRGGBB / RRGGBBAA */
export function hexToRgba(hex: string): [number, number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 6) h += 'ff';
  if (h.length !== 8) h = 'ffffffff';
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
    parseInt(h.slice(6, 8), 16) || 0,
  ];
}

export function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `${c(r)}${c(g)}${c(b)}${c(a)}`;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return rgbaToHex(r, g, b, 255).slice(0, 6);
}

/** int32（大端字节序 R,G,B,A）→ RRGGBBAA */
export function int32ToRgbaHex(v: number): string {
  const u = v >>> 0;
  return rgbaToHex((u >>> 24) & 255, (u >>> 16) & 255, (u >>> 8) & 255, u & 255);
}

/** int32 低 24 位 rgb888 → RRGGBB */
export function int32ToRgbHex(v: number): string {
  const u = v >>> 0;
  return rgbToHex((u >>> 16) & 255, (u >>> 8) & 255, u & 255);
}

/** RRGGBBAA → int32 */
export function rgbaHexToInt32(hex: string): number {
  const [r, g, b, a] = hexToRgba(hex);
  return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0) | 0;
}

/** RRGGBB → int32（低 24 位，高 8 位为 0） */
export function rgbHexToInt32(hex: string): number {
  const [r, g, b] = hexToRgba(hex);
  return ((r << 16) | (g << 8) | b) >>> 0;
}

/** dark 为空的 int32 值（官方编辑器写 -1 即 0xFFFFFFFF） */
export const DARK_NONE_INT = -1;

/* ---------------- 曲线工具 ---------------- */

/** 从 JSON 键对象读取 curve 字段 → 按值数量展开的曲线数组。
 *  兼容三种形式：数组 [c1,c2,c3,c4]（3.2~3.7 共享 / 4.x 逐值 4×n）；
 *  数字 + c2/c3/c4 兄弟键（3.8 编辑器风格）；"stepped" */
export function curveFromJson(keyMap: Record<string, unknown> | undefined, valueCount: number): Curve[] | undefined {
  if (!keyMap) return undefined;
  const raw = keyMap.curve;
  if (raw == null) return undefined;
  if (raw === 'stepped') {
    return Array.from({ length: valueCount }, () => ({ stepped: true } as Curve));
  }
  if (typeof raw === 'number') {
    // 3.8 编辑器：curve: c1 + c2/c3/c4 兄弟键（默认 0,1,1）
    const b: [number, number, number, number] = [
      raw,
      typeof keyMap.c2 === 'number' ? keyMap.c2 : 0,
      typeof keyMap.c3 === 'number' ? keyMap.c3 : 1,
      typeof keyMap.c4 === 'number' ? keyMap.c4 : 1,
    ];
    return Array.from({ length: valueCount }, () => ({ bezier: b } as Curve));
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
    const arr = raw as number[];
    if (arr.length === 4) {
      const b: [number, number, number, number] = [arr[0], arr[1], arr[2], arr[3]];
      return Array.from({ length: valueCount }, () => ({ bezier: b } as Curve));
    }
    const out: Curve[] = [];
    for (let i = 0; i < valueCount; i++) {
      const off = i * 4;
      if (off + 3 < arr.length) {
        out.push({ bezier: [arr[off], arr[off + 1], arr[off + 2], arr[off + 3]] });
      } else {
        out.push(null);
      }
    }
    return out;
  }
  return undefined;
}

/** 曲线数组 → 3.8 JSON 形式（curve: c1 + c2/c3/c4 兄弟键） */
export function curvesToJson38(curves?: Curve[]): {
  fields: Record<string, number> | undefined;
  consistent: boolean;
} {
  if (!curves || curves.length === 0) return { fields: undefined, consistent: true };
  const first = curves[0];
  const consistent = curves.every((c) => curveEquals(c, first));
  if (first == null) return { fields: undefined, consistent };
  if ('stepped' in first) return { fields: undefined, consistent }; // stepped 由调用方处理
  const fields: Record<string, number> = { curve: first.bezier[0] };
  if (first.bezier[1] !== 0) fields.c2 = first.bezier[1];
  if (first.bezier[2] !== 1) fields.c3 = first.bezier[2];
  if (first.bezier[3] !== 1) fields.c4 = first.bezier[3];
  return { fields, consistent };
}

/** 曲线数组 → 4.x JSON curve 数组（4×n 元素）；全为线性/无曲线时返回 undefined */
export function curvesToJson4(curves?: Curve[]): 'stepped' | number[] | undefined {
  if (!curves || curves.length === 0) return undefined;
  const anyCurve = curves.some((c) => c != null);
  if (!anyCurve) return undefined;
  if (curves.every((c) => c != null && 'stepped' in c)) return 'stepped';
  const out: number[] = [];
  for (const c of curves) {
    if (c && 'bezier' in c) out.push(...c.bezier);
    else out.push(0, 0, 1, 1); // 线性占位（4.x 数组必须 4×n）
  }
  return out;
}

export function curveEquals(a: Curve, b: Curve): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if ('stepped' in a && 'stepped' in b) return true;
  if ('bezier' in a && 'bezier' in b) {
    return a.bezier.every((v, i) => v === b.bezier[i]);
  }
  return false;
}

/** 计算曲线数组的贝塞尔段数（写 4.x 二进制 bezierCount 用） */
export function bezierCount(curves?: Curve[]): number {
  if (!curves) return 0;
  return curves.filter((c) => c != null && 'bezier' in c).length;
}

/* ---------------- 时间轴采样（用于单轴合并等兼容转换） ---------------- */

/** 在时间轴键列表中采样 t 时刻的值（线性/阶跃/贝塞尔插值） */
export function sampleTimeline<V>(
  keys: { time: number }[],
  t: number,
  getValue: (i: number) => number[],
  getCurves: (i: number) => Curve[] | undefined,
  valueCount: number,
): number[] {
  if (keys.length === 0) return new Array(valueCount).fill(0);
  const out = new Array(valueCount).fill(0);
  if (t <= keys[0].time) {
    const v = getValue(0);
    for (let i = 0; i < valueCount; i++) out[i] = v[i] ?? 0;
    return out;
  }
  for (let i = keys.length - 1; i >= 0; i--) {
    if (t >= keys[i].time) {
      const v = getValue(i);
      if (i === keys.length - 1 || t === keys[i].time) {
        for (let k = 0; k < valueCount; k++) out[k] = v[k] ?? 0;
        return out;
      }
      const nv = getValue(i + 1);
      const t0 = keys[i].time, t1 = keys[i + 1].time;
      const curves = getCurves(i);
      const span = t1 - t0 || 1e-8;
      const p = (t - t0) / span;
      for (let k = 0; k < valueCount; k++) {
        const c = curves?.[k];
        if (c && 'stepped' in c) { out[k] = v[k] ?? 0; continue; }
        if (c && 'bezier' in c) {
          out[k] = evalBezier(c.bezier, p, v[k] ?? 0, nv[k] ?? 0);
        } else {
          out[k] = (v[k] ?? 0) + ((nv[k] ?? 0) - (v[k] ?? 0)) * p;
        }
      }
      return out;
    }
  }
  return out;
}

/** 三次贝塞尔：cx1,cy1,cx2,cy2 为控制点，x∈[0,1] 为时间比例 */
export function evalBezier(
  [cx1, cy1, cx2, cy2]: [number, number, number, number],
  p: number, v0: number, v1: number,
): number {
  // Spine 曲线：x 轴为时间（0..1 归一），y 轴为值域 v0..v1
  // 二分求 x(t)=p 的 t
  let t = p;
  for (let iter = 0; iter < 12; iter++) {
    const x = bez(t, cx1, cx2) - p;
    if (Math.abs(x) < 1e-5) break;
    const d = bezDeriv(t, cx1, cx2);
    if (Math.abs(d) < 1e-6) break;
    t -= x / d;
    if (t < 0) t = 0; else if (t > 1) t = 1;
  }
  const y = bez(t, cy1, cy2);
  return v0 + (v1 - v0) * y;
}

function bez(t: number, c1: number, c2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t;
}

function bezDeriv(t: number, c1: number, c2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * c1 + 6 * mt * t * (c2 - c1) + 3 * t * t * (1 - c2);
}

/* ---------------- 4.x 绝对曲线 ↔ 归一化曲线 ---------------- */
/* 3.x 曲线：[c1,c2,c3,c4]，c1/c3 为时间比例(0-1)，c2/c4 为值比例(0-1)
 * 4.x 曲线：(cx1,cy1,cx2,cy2) 为绝对时间(秒)与绝对值
 * IR 按源版本原生空间保留（curveSpace 字段），写出前统一转换到目标空间 */

/** 4.x 绝对控制点 → 归一化 */
export function absToNorm(
  cx1: number, cy1: number, cx2: number, cy2: number,
  t0: number, t1: number, v0: number, v1: number,
): [number, number, number, number] {
  const dt = t1 - t0;
  const dv = v1 - v0;
  return [
    dt !== 0 ? (cx1 - t0) / dt : 0,
    dv !== 0 ? (cy1 - v0) / dv : 0,
    dt !== 0 ? (cx2 - t0) / dt : 1,
    dv !== 0 ? (cy2 - v0) / dv : 1,
  ];
}

/** 归一化控制点 → 4.x 绝对 */
export function normToAbs(
  c1: number, c2: number, c3: number, c4: number,
  t0: number, t1: number, v0: number, v1: number,
): [number, number, number, number] {
  const dt = t1 - t0;
  const dv = v1 - v0;
  return [t0 + c1 * dt, v0 + c2 * dv, t0 + c3 * dt, v0 + c4 * dv];
}

/* ---------------- 动画级曲线空间转换（写出侧统一入口） ---------------- */

import type { AnimationIR, DeformKey } from './types';

/** 单条曲线 abs↔norm（用帧端点） */
function convCurve(c: Curve, t0: number, t1: number, v0: number, v1: number, toAbs: boolean): Curve {
  if (!c || !('bezier' in c)) return c;
  const b = c.bezier;
  return {
    bezier: toAbs
      ? normToAbs(b[0], b[1], b[2], b[3], t0, t1, v0, v1)
      : absToNorm(b[0], b[1], b[2], b[3], t0, t1, v0, v1),
  };
}

/** 一组键的曲线数组 abs↔norm（原地修改） */
function convKeyCurves<K extends { time: number; curves?: Curve[] }>(
  keys: K[], getValues: (k: K) => number[], toAbs: boolean,
): void {
  for (let i = 0; i < keys.length - 1; i++) {
    const curves = keys[i].curves;
    if (!curves) continue;
    const t0 = keys[i].time, t1 = keys[i + 1].time;
    const v0 = getValues(keys[i]), v1 = getValues(keys[i + 1]);
    for (let val = 0; val < curves.length; val++) {
      curves[val] = convCurve(curves[val], t0, t1, v0[val] ?? 0, v1[val] ?? 0, toAbs);
    }
  }
}

/** deform 曲线：cx 为绝对时间(4.x)/归一化(3.x)，cy 固定 0-1 —— 仅转换 cx */
function convDeformCurves(keys: DeformKey[], toAbs: boolean): void {
  for (let i = 0; i < keys.length - 1; i++) {
    const c = keys[i].curve;
    if (!c || !('bezier' in c)) continue;
    const t0 = keys[i].time, t1 = keys[i + 1].time;
    const dt = t1 - t0;
    const b = c.bezier;
    keys[i].curve = {
      bezier: toAbs
        ? [t0 + b[0] * dt, b[1], t0 + b[2] * dt, b[3]]
        : [dt !== 0 ? (b[0] - t0) / dt : 0, b[1], dt !== 0 ? (b[2] - t0) / dt : 1, b[3]],
    };
  }
}

/** 把一个动画的全部曲线在 abs↔norm 之间转换（原地） */
export function convertAnimationCurves(anim: AnimationIR, toAbs: boolean): void {
  const rgbaOf = (hex: string) => hexToRgba(hex).map((x) => x / 255);
  for (const bt of Object.values(anim.bone)) {
    if (bt.rotate) convKeyCurves(bt.rotate, (k) => [k.angle], toAbs);
    if (bt.translate) convKeyCurves(bt.translate, (k) => [k.x, k.y], toAbs);
    if (bt.translatex) convKeyCurves(bt.translatex, (k) => [k.value], toAbs);
    if (bt.translatey) convKeyCurves(bt.translatey, (k) => [k.value], toAbs);
    if (bt.scale) convKeyCurves(bt.scale, (k) => [k.x, k.y], toAbs);
    if (bt.scalex) convKeyCurves(bt.scalex, (k) => [k.value], toAbs);
    if (bt.scaley) convKeyCurves(bt.scaley, (k) => [k.value], toAbs);
    if (bt.shear) convKeyCurves(bt.shear, (k) => [k.x, k.y], toAbs);
    if (bt.shearx) convKeyCurves(bt.shearx, (k) => [k.value], toAbs);
    if (bt.sheary) convKeyCurves(bt.sheary, (k) => [k.value], toAbs);
  }
  for (const st of Object.values(anim.slot)) {
    if (st.color) convKeyCurves(st.color, (k) => rgbaOf(k.color), toAbs);
    if (st.twoColor) convKeyCurves(st.twoColor, (k) => [...rgbaOf(k.light), ...rgbaOf(k.dark).slice(0, 3)], toAbs);
    if (st.alpha) convKeyCurves(st.alpha, (k) => [k.value], toAbs);
  }
  for (const keys of Object.values(anim.ik)) convKeyCurves(keys, (k) => [k.mix, k.softness], toAbs);
  for (const keys of Object.values(anim.transform)) {
    convKeyCurves(keys, (k) => [k.mixRotate, k.mixX, k.mixY, k.mixScaleX, k.mixScaleY, k.mixShearY], toAbs);
  }
  for (const pt of Object.values(anim.path)) {
    if (pt.position) convKeyCurves(pt.position, (k) => [k.value], toAbs);
    if (pt.spacing) convKeyCurves(pt.spacing, (k) => [k.value], toAbs);
    if (pt.mix) convKeyCurves(pt.mix, (k) => [k.mixRotate, k.mixX, k.mixY], toAbs);
  }
  for (const pt of Object.values(anim.physics)) {
    for (const field of ['inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'] as const) {
      const keys = pt[field];
      if (keys) convKeyCurves(keys, (k) => [k.value], toAbs);
    }
  }
  for (const slots of Object.values(anim.deform)) {
    for (const atts of Object.values(slots)) {
      for (const keys of Object.values(atts)) convDeformCurves(keys, toAbs);
    }
  }
}

/** 把整副骨架的曲线转换到目标版本原生空间（原地）。返回同一 IR 引用。 */
export function convertSkeletonCurves<T extends { curveSpace?: 'norm' | 'abs'; animations: AnimationIR[] }>(
  ir: T, target: SpineVersionLike,
): T {
  const wantAbs = target.startsWith('4.');
  const cur = ir.curveSpace ?? 'norm';
  if (cur === (wantAbs ? 'abs' : 'norm')) return ir;
  for (const anim of ir.animations) convertAnimationCurves(anim, wantAbs);
  ir.curveSpace = wantAbs ? 'abs' : 'norm';
  return ir;
}

type SpineVersionLike = string;

/** 归一化曲线 → 4.x 绝对（写出侧），返回 null 表示线性/阶跃无需处理 */
export function curveToAbs(
  c: Curve, t0: number, t1: number, v0: number, v1: number,
): [number, number, number, number] | null {
  if (!c || !('bezier' in c)) return null;
  return normToAbs(c.bezier[0], c.bezier[1], c.bezier[2], c.bezier[3], t0, t1, v0, v1);
}
