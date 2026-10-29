/**
 * 二进制 .skel 解析器 —— 支持 3.4 / 3.5 / 3.6 / 3.7 / 3.8 / 4.0 / 4.1 / 4.2 六大格式族。
 * 布局依据官方 spine-libgdx 运行时源码逐字节实证（见 research/spine-format-spec.md）。
 * 3.2 / 3.3 的 .skel 按 3.4 家族尽力读取。
 */
import {
  type SkeletonIR, type SpineVersion, type AttachmentIR, type VerticesIR,
  type SequenceIR, type Curve, type DeformKey, type SequenceKey, type SequenceMode,
  type TransformMode, type BlendMode, type AnimationIR, type RotateMode,
} from './types';
import { PROFILES } from './spec';
import { BinReader } from './binIo';
import { int32ToRgbHex, int32ToRgbaHex, rgbaToHex, rgbToHex, hexToRgba } from './color';
import { bytesToB64 } from './binIo';

/** 全线性曲线数组 → undefined（与 jsonReader 行为对齐：无曲线时不设键） */
function pruneLinear(curves: import('./types').Curve[] | undefined): import('./types').Curve[] | undefined {
  if (!curves) return undefined;
  return curves.some((c) => c != null) ? curves : undefined;
}

const TRANSFORM_MODES: TransformMode[] = [
  'normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection',
];
const SEQUENCE_MODES: SequenceMode[] = [
  'hold', 'once', 'loop', 'pingpong', 'onceReverse', 'loopReverse', 'pingpongReverse',
];
const BLENDS: BlendMode[] = ['normal', 'additive', 'multiply', 'screen'];

export function readBinary(data: ArrayBuffer, version: SpineVersion, trace?: (pos: number, what: string) => void): SkeletonIR {
  const P = PROFILES[version];
  const b = P.bin;
  const r = new BinReader(data);
  r.trace = trace ?? null;

  /* ---------- 头部 ---------- */
  let hash: string | null;
  if (b.hashAsLong) {
    /* 4.x：hash 为 8 字节大端 int64；JSON 侧为同值 base64 字符串 */
    const hb: number[] = [];
    for (let i = 0; i < 8; i++) hb.push(r.byte());
    hash = hb.every((x) => x === 0) ? null : bytesToB64(hb);
  } else {
    hash = r.string();
  }
  const versionStr = r.string() ?? '';
  const x = b.hasSkeletonXY ? r.float() : 0;
  const y = b.hasSkeletonXY ? r.float() : 0;
  const width = r.float();
  const height = r.float();
  const referenceScale = b.hasRefScale ? r.float() : 100;
  const nonessential = r.boolean();
  let fps = 30;
  let imagesPath: string | null = null;
  let audioPath: string | null = null;
  if (nonessential) {
    if (b.hasFps) fps = r.float();
    imagesPath = r.string();
    if (b.hasAudioPath) audioPath = r.string();
  }

  /* ---------- 字符串表 ---------- */
  if (b.hasStrTable) {
    const n = r.varint();
    for (let i = 0; i < n; i++) r.strings[i] = r.string();
  }

  const ir: SkeletonIR = {
    hash, version: versionStr, x, y, width, height, fps, imagesPath, audioPath,
    referenceScale, 
    /* 4.x：曲线为绝对坐标，按原生空间保留；写出时统一转换 */
    curveSpace: version.startsWith('4.') ? 'abs' : 'norm',
    bones: [], slots: [], ik: [], transform: [], path: [], physics: [],
    defaultSkin: null, skins: [], events: [], animations: [],
  };

  /* ---------- 骨骼 ---------- */
  const boneCount = r.varint();
  for (let i = 0; i < boneCount; i++) {
    const name = r.string() ?? `bone${i}`;
    const parentIdx = i === 0 ? null : r.varint();
    const rotation = r.float(), bx = r.float(), by = r.float();
    const scaleX = r.float(), scaleY = r.float();
    const shearX = r.float(), shearY = r.float();
    const length = r.float();
    let transformMode: TransformMode = 'normal';
    let inhR = true, inhS = true;
    if (b.hasTransformModes) {
      const tm = b.inheritAsByte ? r.byte() : r.varint();
      transformMode = TRANSFORM_MODES[tm] ?? 'normal';
    } else {
      inhR = r.boolean(); inhS = r.boolean();
      transformMode = inhR && inhS ? 'normal' : !inhR && !inhS ? 'onlyTranslation'
        : !inhR ? 'noRotationOrReflection' : 'noScale';
    }
    const skinRequired = b.hasSkinRequired ? r.boolean() : false;
    let color: string | null = null;
    let icon: string | null = null;
    let visible: boolean | undefined;
    if (nonessential) {
      color = int32ToRgbaHex(r.int32());
      if (b.boneIconVisible) {
        icon = r.string();
        visible = r.boolean();
      }
    }
    ir.bones.push({
      name, parent: parentIdx == null ? null : ir.bones[parentIdx]?.name ?? null,
      length, rotation, x: bx, y: by, scaleX, scaleY, shearX, shearY,
      transformMode, inheritRotation: inhR, inheritScale: inhS,
      skinRequired: b.hasSkinRequired ? skinRequired : undefined,
      color, icon, visible,
    });
  }

  /* ---------- 槽位 ---------- */
  const slotCount = r.varint();
  for (let i = 0; i < slotCount; i++) {
    const name = r.string() ?? `slot${i}`;
    const boneIdx = r.varint();
    const color = int32ToRgbaHex(r.int32());
    let dark: string | undefined;
    if (b.hasSlotDark) {
      const dc = r.int32();
      /* 官方语义：仅 -1（0xFFFFFFFF）表示无 dark 色；0xFFFFFF 为合法白色 dark */
      dark = dc === -1 ? undefined : int32ToRgbHex(dc);
    }
    const attachment = b.hasStrTable ? r.stringRef() : r.string();
    const blend = BLENDS[r.varint()] ?? 'normal';
    let visible: boolean | undefined;
    if (b.boneIconVisible && nonessential) visible = r.boolean();
    ir.slots.push({
      name, bone: ir.bones[boneIdx]?.name ?? '', color,
      dark, attachment, blend, visible,
    });
  }

  /* ---------- IK 约束 ---------- */
  const ikCount = r.varint();
  for (let i = 0; i < ikCount; i++) {
    const name = r.string() ?? `ik${i}`;
    const order = b.hasConstraintOrder ? r.varint() : 0;
    let skinRequired = false;
    let bones: string[] = [];
    let mix = 0, softness = 0;
    let bendDirection: 1 | -1 = 1;
    let compress = false, stretch = false, uniform = false;
    if (b.flagsConstraints) {
      const boneCount = r.varint();
      for (let k = 0; k < boneCount; k++) bones.push(ir.bones[r.varint()]?.name ?? '');
      const target = ir.bones[r.varint()]?.name ?? '';
      const flags = r.byte();
      skinRequired = (flags & 1) !== 0;
      bendDirection = (flags & 2) !== 0 ? 1 : -1;
      compress = (flags & 4) !== 0;
      stretch = (flags & 8) !== 0;
      uniform = (flags & 16) !== 0;
      /* 官方字段默认 mix=0：bit5 有 mix、bit6 显式浮点（bit5 单独置位读作 1） */
      if ((flags & 32) !== 0) mix = (flags & 64) !== 0 ? r.float() : 1;
      if ((flags & 128) !== 0) softness = r.float();
      ir.ik.push({ name, order, skinRequired, bones, target, mix, softness, bendDirection, compress, stretch, uniform });
      continue;
    }
    if (b.hasSkinRequired) skinRequired = r.boolean();
    const boneCount = r.varint();
    for (let k = 0; k < boneCount; k++) bones.push(ir.bones[r.varint()]?.name ?? '');
    const target = ir.bones[r.varint()]?.name ?? '';
    mix = r.float();
    if (b.hasIkSoftness) softness = r.float();
    bendDirection = (r.sbyte() as 1 | -1);
    if (b.hasIkStretch) {
      compress = r.boolean(); stretch = r.boolean(); uniform = r.boolean();
    }
    ir.ik.push({ name, order, skinRequired, bones, target, mix, softness, bendDirection, compress, stretch, uniform });
  }

  /* ---------- 变换约束 ---------- */
  if (!b.omitTransformPathSections) {
    const n = r.varint();
    for (let i = 0; i < n; i++) {
      const name = r.string() ?? `transform${i}`;
      const order = b.hasConstraintOrder ? r.varint() : 0;
      let skinRequired = false;
      let local = false, relative = false;
      let offsetRotation = 0, offsetX = 0, offsetY = 0;
      let offsetScaleX = 0, offsetScaleY = 0, offsetShearY = 0;
      let mixRotate = 1, mixX = 1, mixY = 1, mixScaleX = 1, mixScaleY = 1, mixShearY = 1;
      const bones: string[] = [];
      if (b.flagsConstraints) {
        const bc = r.varint();
        for (let k = 0; k < bc; k++) bones.push(ir.bones[r.varint()]?.name ?? '');
        const target = ir.bones[r.varint()]?.name ?? '';
        let flags = r.byte();
        skinRequired = (flags & 1) !== 0;
        local = (flags & 2) !== 0;
        relative = (flags & 4) !== 0;
        if ((flags & 8) !== 0) offsetRotation = r.float();
        if ((flags & 16) !== 0) offsetX = r.float();
        if ((flags & 32) !== 0) offsetY = r.float();
        if ((flags & 64) !== 0) offsetScaleX = r.float();
        if ((flags & 128) !== 0) offsetScaleY = r.float();
        flags = r.byte();
        if ((flags & 1) !== 0) offsetShearY = r.float();
        /* 官方字段默认 mix=0：置位才读浮点 */
        mixRotate = 0; mixX = 0; mixY = 0; mixScaleX = 0; mixScaleY = 0; mixShearY = 0;
        if ((flags & 2) !== 0) mixRotate = r.float();
        if ((flags & 4) !== 0) mixX = r.float();
        if ((flags & 8) !== 0) mixY = r.float();
        if ((flags & 16) !== 0) mixScaleX = r.float();
        if ((flags & 32) !== 0) mixScaleY = r.float();
        if ((flags & 64) !== 0) mixShearY = r.float();
        ir.transform.push({
          name, order, skinRequired, bones, target, local, relative,
          offsetRotation, offsetX, offsetY, offsetScaleX, offsetScaleY, offsetShearY,
          mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY,
        });
        continue;
      }
      if (b.hasSkinRequired) skinRequired = r.boolean();
      const bc = r.varint();
      for (let k = 0; k < bc; k++) bones.push(ir.bones[r.varint()]?.name ?? '');
      const target = ir.bones[r.varint()]?.name ?? '';
      if (b.hasSlotDark) { local = r.boolean(); relative = r.boolean(); }
      offsetRotation = r.float(); offsetX = r.float(); offsetY = r.float();
      offsetScaleX = r.float(); offsetScaleY = r.float(); offsetShearY = r.float();
      mixRotate = r.float();
      if (version.startsWith('4.')) {
        mixX = r.float(); mixY = r.float();
        mixScaleX = r.float(); mixScaleY = r.float();
        mixShearY = r.float();
      } else {
        mixX = r.float(); mixScaleX = r.float(); mixShearY = r.float();
        mixY = mixX; mixScaleY = mixScaleX;
      }
      ir.transform.push({
        name, order, skinRequired, bones, target, local, relative,
        offsetRotation, offsetX, offsetY, offsetScaleX, offsetScaleY, offsetShearY,
        mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY,
      });
    }
  }

  /* ---------- 路径约束 ---------- */
  if (!b.omitTransformPathSections) {
    const n = r.varint();
    for (let i = 0; i < n; i++) {
      const name = r.string() ?? `path${i}`;
      const order = b.hasConstraintOrder ? r.varint() : 0;
      let skinRequired = false;
      /* 注意：4.2 路径约束的 skinRequired 为独立布尔（IK/变换约束在 flags 内） */
      if (b.flagsConstraints) skinRequired = r.boolean();
      else if (b.hasSkinRequired) skinRequired = r.boolean();
      const bones: string[] = [];
      const bc = r.varint();
      for (let k = 0; k < bc; k++) bones.push(ir.bones[r.varint()]?.name ?? '');
      const target = ir.slots[r.varint()]?.name ?? '';
      let positionMode: 'fixed' | 'percent' = 'percent';
      let spacingMode: import('./types').SpacingMode = 'length';
      let rotateMode: RotateMode = 'tangent';
      let offsetRotation = 0;
      if (b.flagsConstraints) {
        const flags = r.byte();
        /* 官方枚举序：PositionMode [fixed, percent]（bit0=1 → percent）；SpacingMode [length, fixed, percent, proportional] */
        positionMode = (flags & 1) ? 'percent' : 'fixed';
        spacingMode = (['length', 'fixed', 'percent', 'proportional'] as const)[(flags >> 1) & 3] ?? 'length';
        rotateMode = (['tangent', 'chain', 'chainScale'] as const)[(flags >> 3) & 3] ?? 'tangent';
        if ((flags & 128) !== 0) offsetRotation = r.float();
      } else {
        positionMode = (['fixed', 'percent'] as const)[r.varint()] ?? 'percent';
        spacingMode = (['length', 'fixed', 'percent'] as const)[r.varint()] ?? 'length';
        rotateMode = (['tangent', 'chain', 'chainScale'] as const)[r.varint()] ?? 'tangent';
        offsetRotation = r.float();
      }
      const position = r.float();
      const spacing = r.float();
      let mixRotate: number, mixX: number, mixY: number;
      if (version.startsWith('4.')) {
        mixRotate = r.float(); mixX = r.float(); mixY = r.float();
      } else {
        mixRotate = r.float(); mixX = r.float(); mixY = mixX;
      }
      ir.path.push({ name, order, skinRequired, bones, target, positionMode, spacingMode, rotateMode, offsetRotation, position, spacing, mixRotate, mixX, mixY });
    }
  }

  /* ---------- 物理约束（4.2） ---------- */
  if (b.hasPhysics) {
    const n = r.varint();
    for (let i = 0; i < n; i++) {
      const name = r.string() ?? `physics${i}`;
      const order = r.varint();
      const bone = ir.bones[r.varint()]?.name ?? '';
      const flags1 = r.byte();
      const skinRequired = (flags1 & 1) !== 0;
      const x = (flags1 & 2) !== 0 ? r.float() : 0;
      const y = (flags1 & 4) !== 0 ? r.float() : 0;
      const rotate = (flags1 & 8) !== 0 ? r.float() : 0;
      const scaleX = (flags1 & 16) !== 0 ? r.float() : 0;
      const shearX = (flags1 & 32) !== 0 ? r.float() : 0;
      const limit = (flags1 & 64) !== 0 ? r.float() : 5000;
      const fps = r.byte() || 60;
      const inertia = r.float(), strength = r.float(), damping = r.float();
      const massInverse = (flags1 & 128) !== 0 ? r.float() : 1; /* 官方存 massInverse = 1/mass */
      const wind = r.float(), gravity = r.float();
      const mass = massInverse === 0 ? Infinity : 1 / massInverse;
      const flags2 = r.byte();
      const mix = (flags2 & 128) !== 0 ? r.float() : 1;
      ir.physics.push({
        name, order, skinRequired, bone,
        x, y, rotate, scaleX, shearX, limit, fps,
        inertia, strength, damping, mass, wind, gravity, mix,
        inertiaGlobal: (flags2 & 1) !== 0, strengthGlobal: (flags2 & 2) !== 0,
        dampingGlobal: (flags2 & 4) !== 0, massGlobal: (flags2 & 8) !== 0,
        windGlobal: (flags2 & 16) !== 0, gravityGlobal: (flags2 & 32) !== 0,
        mixGlobal: (flags2 & 64) !== 0,
      });
    }
  }

  /* ---------- 皮肤 ---------- */
  const readSkin = (isDefault: boolean) => {
    let slotCount: number;
    let name = 'default';
    let color: string | null = null;
    const bones: string[] = [];
    const constraints = { ik: [] as string[], transform: [] as string[], path: [] as string[], physics: [] as string[] };
    if (isDefault) {
      slotCount = r.varint();
      if (slotCount === 0) return null;
    } else {
      if (b.hasStrTable) name = (b.flagsConstraints ? r.string() : r.stringRef()) ?? `skin${ir.skins.length}`;
      else name = r.string() ?? `skin${ir.skins.length}`;
      if (b.skinColor && nonessential) color = int32ToRgbaHex(r.int32());
      if (b.hasSkinBones) {
        const nb = r.varint();
        for (let i = 0; i < nb; i++) bones.push(ir.bones[r.varint()]?.name ?? '');
        const ni = r.varint();
        for (let i = 0; i < ni; i++) constraints.ik.push(ir.ik[r.varint()]?.name ?? '');
        const nt = r.varint();
        for (let i = 0; i < nt; i++) constraints.transform.push(ir.transform[r.varint()]?.name ?? '');
        const np = r.varint();
        for (let i = 0; i < np; i++) constraints.path.push(ir.path[r.varint()]?.name ?? '');
        if (b.hasPhysics) {
          const nph = r.varint();
          for (let i = 0; i < nph; i++) constraints.physics.push(ir.physics[r.varint()]?.name ?? '');
        }
      }
      slotCount = r.varint();
      /* 3.2~3.7（无字符串表）：官方 readSkin 对 slotCount==0 的非默认皮肤返回 null（跳过） */
      if (!b.hasStrTable && slotCount === 0) return null;
    }
    const entries: { slot: string; name: string; attachment: AttachmentIR }[] = [];
    for (let i = 0; i < slotCount; i++) {
      const slotIndex = r.varint();
      const attCount = r.varint();
      for (let k = 0; k < attCount; k++) {
        const attName = b.hasStrTable ? (r.stringRef() ?? '') : (r.string() ?? '');
        const att = readAttachment(r, ir, version, attName, nonessential);
        if (att) entries.push({ slot: ir.slots[slotIndex]?.name ?? '', name: attName, attachment: att });
      }
    }
    return { name, bones, constraints, entries, color };
  };

  const defaultSkin = readSkin(true);
  if (defaultSkin) {
    ir.defaultSkin = { ...defaultSkin, color: defaultSkin.color ?? null };
  }
  const skinCount = r.varint();
  for (let i = 0; i < skinCount; i++) {
    const s = readSkin(false);
    if (s) ir.skins.push(s);
  }

  /* ---------- 事件 ---------- */
  const eventCount = r.varint();
  for (let i = 0; i < eventCount; i++) {
    const name = (b.hasStrTable && !b.flagsConstraints) ? (r.stringRef() ?? `event${i}`) : (r.string() ?? `event${i}`);
    const int = r.varintZ();
    const float = r.float();
    const string = r.string() ?? '';
    let audio: string | null = null;
    let volume = 1, balance = 0;
    if (b.hasEventAudio) {
      audio = r.string();
      if (audio != null) { volume = r.float(); balance = r.float(); }
    }
    ir.events.push({ name, int, float, string, audio, volume, balance });
  }

  /* ---------- 动画 ---------- */
  const animCount = r.varint();
  for (let i = 0; i < animCount; i++) {
    const name = r.string() ?? `animation${i}`;
    ir.animations.push(readAnimation(r, name, ir, version, nonessential));
  }

  return ir;
}

/* ---------------- 附件 ---------------- */

function readVertices(r: BinReader, vertexCount: number | null, weighted: boolean): { vc: number; verts: VerticesIR } {
  // 3.x / 4.0 / 4.1：vertexCount 由调用方提供，weighted 从布尔读取
  // 4.2：weighted 来自附件 flags，vertexCount 在内部读取
  const vc = vertexCount ?? r.varint();
  if (!weighted) {
    return { vc, verts: { weighted: false, vertices: r.floatArray(vc * 2) } };
  }
  const bones: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < vc; i++) {
    const n = r.varint();
    bones.push(n);
    for (let k = 0; k < n; k++) {
      bones.push(r.varint());
      weights.push(r.float(), r.float(), r.float());
    }
  }
  return { vc, verts: { weighted: true, vertices: weights, bones } };
}

function readSequenceBinary(r: BinReader, withBoolPrefix: boolean): SequenceIR | null {
  if (withBoolPrefix && !r.boolean()) return null;
  const count = r.varint();
  const start = r.varint();
  const digits = r.varint();
  const setup = r.varint();
  return { count, start, digits, setup };
}

function readAttachment(r: BinReader, ir: SkeletonIR, version: SpineVersion, attName: string, nonessential: boolean): AttachmentIR | null {
  const P = PROFILES[version];
  const b = P.bin;
  const is42 = b.attachmentFlags;

  let name = attName;
  let type: number;
  let flags = 0;

  if (is42) {
    flags = r.byte();
    if ((flags & 8) !== 0) name = r.stringRef() ?? attName;
    type = flags & 0b111;
  } else {
    const n = b.hasStrTable ? r.stringRef() : r.string();
    if (n != null) name = n;
    type = r.byte();
  }

  switch (type) {
    case 0: { // region
      let path: string | null = null;
      let rotation = 0;
      let color = 'ffffffff';
      let sequence: SequenceIR | null = null;
      if (is42) {
        path = (flags & 16) !== 0 ? r.stringRef() : name;
        if ((flags & 32) !== 0) color = int32ToRgbaHex(r.int32());
        if ((flags & 64) !== 0) sequence = readSequenceBinary(r, false);
        if ((flags & 128) !== 0) rotation = r.float();
      } else {
        /* 3.4~4.1 官方布局：path, rotation, x, y, scaleX, scaleY, width, height, color, [sequence(4.1)] */
        path = (b.hasStrTable ? r.stringRef() : r.string()) ?? name;
        rotation = r.float();
        const x = r.float(), y = r.float();
        const scaleX = r.float(), scaleY = r.float();
        const width = r.float(), height = r.float();
        color = int32ToRgbaHex(r.int32());
        if (b.hasSequence) sequence = readSequenceBinary(r, true);
        return {
          type: 'region', name, path, rotation, x, y, scaleX, scaleY, width, height,
          color, sequence,
        };
      }
      const x = r.float(), y = r.float();
      const scaleX = r.float(), scaleY = r.float();
      const width = r.float(), height = r.float();
      return {
        type: 'region', name, path, rotation, x, y, scaleX, scaleY, width, height,
        color, sequence,
      };
    }
    case 1: { // boundingbox
      let verts: VerticesIR;
      if (is42) {
        verts = readVertices(r, null, (flags & 16) !== 0).verts;
      } else {
        const vc = r.varint();
        verts = readVertices(r, vc, r.boolean()).verts;
      }
      const color = nonessential ? int32ToRgbaHex(r.int32()) : null;
      return { type: 'boundingbox', name, verts, color };
    }
    case 2: { // mesh
      let path: string | null = null;
      let color = 'ffffffff';
      let sequence: SequenceIR | null = null;
      let verts: VerticesIR;
      let uvs: number[];
      let triangles: number[];
      let hull: number;
      let edges: number[] | null = null;
      let width = 0, height = 0;
      if (is42) {
        path = (flags & 16) !== 0 ? r.stringRef() : name;
        if ((flags & 32) !== 0) color = int32ToRgbaHex(r.int32());
        if ((flags & 64) !== 0) sequence = readSequenceBinary(r, false);
        hull = r.varint();
        const rv = readVertices(r, null, (flags & 128) !== 0);
        verts = rv.verts;
        uvs = r.floatArray(rv.vc * 2);
        const triCount = (rv.vc * 2 - hull - 2) * 3;
        triangles = r.shortArrayVarint(triCount);
        if (nonessential) {
          const edgeCount = r.varint();
          edges = edgeCount > 0 ? r.shortArrayVarint(edgeCount) : null;
          width = r.float(); height = r.float();
        }
      } else {
        path = (b.hasStrTable ? r.stringRef() : r.string()) ?? name;
        color = int32ToRgbaHex(r.int32());
        const vc = r.varint();
        uvs = r.floatArray(vc * 2);
        triangles = r.shortArrayRaw();
        verts = readVertices(r, vc, r.boolean()).verts;
        hull = r.varint();
        if (b.hasSequence) sequence = readSequenceBinary(r, true);
        if (nonessential) {
          const e = r.shortArrayRaw();
          edges = e.length ? e : null;
          width = r.float(); height = r.float();
        }
      }
      return {
        type: 'mesh', name, path, uvs, triangles, verts, hull,
        edges, width, height, color, sequence,
      };
    }
    case 3: { // linkedmesh
      let path: string | null = null;
      let color = 'ffffffff';
      let sequence: SequenceIR | null = null;
      let skin: string | null = null;
      let parent = '';
      let deform = true;
      let width = 0, height = 0;
      if (is42) {
        path = (flags & 16) !== 0 ? r.stringRef() : name;
        if ((flags & 32) !== 0) color = int32ToRgbaHex(r.int32());
        if ((flags & 64) !== 0) sequence = readSequenceBinary(r, false);
        deform = (flags & 128) !== 0;
        const skinIndex = r.varint();
        const skins = [ir.defaultSkin, ...ir.skins].filter(Boolean);
        // 4.2：skinIndex 为 skins 数组索引（default 在首位），0 = default skin
        skin = skinIndex === 0 ? null : (skins[skinIndex]?.name ?? null);
        parent = r.stringRef() ?? '';
        if (nonessential) { width = r.float(); height = r.float(); }
      } else {
        path = (b.hasStrTable ? r.stringRef() : r.string()) ?? name;
        color = int32ToRgbaHex(r.int32());
        skin = b.hasStrTable ? r.stringRef() : r.string();
        parent = (b.hasStrTable ? r.stringRef() : r.string()) ?? '';
        if (b.hasInheritDeform) deform = r.boolean();
        if (b.hasSequence) sequence = readSequenceBinary(r, true);
        if (nonessential) { width = r.float(); height = r.float(); }
      }
      return { type: 'linkedmesh', name, path, skin, parent, deform, width, height, color, sequence };
    }
    case 4: { // path
      let closed = false, constantSpeed = true;
      let verts: VerticesIR;
      let vc2: number;
      if (is42) {
        closed = (flags & 16) !== 0;
        constantSpeed = (flags & 32) !== 0;
        const rv = readVertices(r, null, (flags & 64) !== 0);
        verts = rv.verts; vc2 = rv.vc;
      } else {
        closed = r.boolean();
        constantSpeed = r.boolean();
        vc2 = r.varint();
        verts = readVertices(r, vc2, r.boolean()).verts;
      }
      const segCount = Math.max(0, Math.floor(vc2 / 3));
      const lengths: number[] = [];
      for (let i = 0; i < segCount; i++) lengths.push(r.float());
      const color = nonessential ? int32ToRgbaHex(r.int32()) : null;
      return { type: 'path', name, closed, constantSpeed, vertexCount: vc2, verts, lengths, color };
    }
    case 5: { // point
      const rotation = r.float();
      const x = r.float(), y = r.float();
      const color = nonessential ? int32ToRgbaHex(r.int32()) : null;
      return { type: 'point', name, rotation, x, y, color };
    }
    case 6: { // clipping
      let endSlotIndex: number;
      let verts: VerticesIR;
      let vc3: number;
      if (is42) {
        endSlotIndex = r.varint();
        const rv = readVertices(r, null, (flags & 16) !== 0);
        verts = rv.verts; vc3 = rv.vc;
      } else {
        endSlotIndex = r.varint();
        vc3 = r.varint();
        verts = readVertices(r, vc3, r.boolean()).verts;
      }
      const color = nonessential ? int32ToRgbaHex(r.int32()) : null;
      return { type: 'clipping', name, end: ir.slots[endSlotIndex]?.name ?? '', vertexCount: vc3, verts, color };
    }
    default:
      throw new Error(`未知的附件类型 ID：${type}`);
  }
}

function countWeightedVertices(verts: VerticesIR): number {
  const bones = verts.bones ?? [];
  let n = 0, i = 0;
  while (i < bones.length) {
    const c = bones[i];
    i += 1 + c;
    n++;
  }
  return n;
}

/* ---------------- 动画 ---------------- */

function readCurve3x(r: BinReader): Curve {
  const t = r.byte();
  if (t === 1) return { stepped: true };
  if (t === 2) return { bezier: [r.float(), r.float(), r.float(), r.float()] };
  return null;
}

function readAnimation(r: BinReader, name: string, ir: SkeletonIR, version: SpineVersion, _nonessential: boolean): AnimationIR {
  const P = PROFILES[version];
  const b = P.bin;
  const is4 = version.startsWith('4.');
  const anim: AnimationIR = {
    name, bone: {}, slot: {}, ik: {}, transform: {}, path: {}, physics: {},
    deform: {}, sequence: {}, drawOrder: [], events: [],
  };
  /* 4.x：动画头部有一个总时间轴计数 varint（仅作容量提示） */
  if (is4) { const totalTl = r.varint(); void totalTl; }
  const boneIdx = new Map(ir.bones.map((x, i) => [i, x.name]));
  const slotIdx = new Map(ir.slots.map((x, i) => [i, x.name]));
  const skins = [ir.defaultSkin, ...ir.skins].filter(Boolean);

  /* 槽位时间轴 */
  const slotCount = r.varint();
  for (let i = 0; i < slotCount; i++) {
    const sIndex = r.varint();
    const sName = slotIdx.get(sIndex) ?? `slot${sIndex}`;
    const st = anim.slot[sName] ??= {};
    const tlCount = r.varint();
    for (let k = 0; k < tlCount; k++) {
      const type = r.byte();
      const frameCount = r.varint();
      if (!is4) {
        /* 3.x：attachment=0 / color=1 / twoColor=2，颜色 int32，共享曲线 */
        if (type === 0) {
          st.attachment = [];
          for (let f = 0; f < frameCount; f++) {
            st.attachment.push({ time: r.float(), name: b.hasStrTable ? r.stringRef() : r.string() });
          }
        } else if (type === 1) {
          const keys: NonNullable<typeof st.color> = [];
          for (let f = 0; f < frameCount; f++) {
            const time = r.float();
            const color = int32ToRgbaHex(r.int32());
            const curve = f < frameCount - 1 ? readCurve3x(r) : null;
            keys.push({ time, color, curves: curve ? [curve, curve, curve, curve] : undefined });
          }
          st.color = keys;
        } else if (type === 2) {
          const keys: NonNullable<typeof st.twoColor> = [];
          for (let f = 0; f < frameCount; f++) {
            const time = r.float();
            const light = int32ToRgbaHex(r.int32());
            const dark = int32ToRgbHex(r.int32());
            const curve = f < frameCount - 1 ? readCurve3x(r) : null;
            keys.push({ time, light, dark, curves: curve ? Array(7).fill(curve) : undefined });
          }
          st.twoColor = keys;
        } else {
          throw new Error(`未知的槽位时间轴类型：${type}`);
        }
      } else {
        /* 4.x：字节颜色 + bezierCount + 逐值曲线（attachment 类型无 bezierCount） */
        if (type !== 0) { const bezierCountTotal = r.varint(); void bezierCountTotal; }
        if (type === 0) {
          st.attachment = [];
          for (let f = 0; f < frameCount; f++) {
            st.attachment.push({ time: r.float(), name: r.stringRef() });
          }
        } else if (type === 1 || type === 2) {
          // rgba / rgb（rgb 用槽位 setup alpha 补全，与 jsonReader 一致）
          const hasAlpha = type === 1;
          const vc = hasAlpha ? 4 : 3;
          const setupAlpha = hexToRgba(ir.slots[sIndex]?.color ?? 'ffffffff')[3];
          const keys: typeof st.color = [];
          let time = r.float();
          let rgba = readColorBytes(r, hasAlpha);
          for (let f = 0; ; f++) {
            keys.push({ time, color: rgbaToHex(rgba[0], rgba[1], rgba[2], hasAlpha ? rgba[3] : setupAlpha), curves: undefined });
            if (f === frameCount - 1) break;
            const time2 = r.float();
            const rgba2 = readColorBytes(r, hasAlpha);
            const curves = pruneLinear(readCurve4(r, vc));
            keys[keys.length - 1].curves = curves;
            time = time2; rgba = rgba2;
          }
          st.color = keys;
        } else if (type === 3 || type === 4) {
          // rgba2 / rgb2（rgb2 用槽位 setup alpha 补全）
          const hasAlpha = type === 3;
          const vc = hasAlpha ? 7 : 6;
          const setupAlpha = hexToRgba(ir.slots[sIndex]?.color ?? 'ffffffff')[3];
          const keys: typeof st.twoColor = [];
          let time = r.float();
          let [l0, l1, l2, l3] = readColorBytes(r, hasAlpha);
          let [d0, d1, d2] = readColorBytes(r, false);
          for (let f = 0; ; f++) {
            keys.push({
              time,
              light: rgbaToHex(l0, l1, l2, hasAlpha ? l3 : setupAlpha),
              dark: rgbToHex(d0, d1, d2),
              curves: undefined,
            });
            if (f === frameCount - 1) break;
            const time2 = r.float();
            const nl = readColorBytes(r, hasAlpha);
            const nd = readColorBytes(r, false);
            const v0 = [...[l0, l1, l2].map((x) => x / 255), ...(hasAlpha ? [l3 / 255] : []), d0 / 255, d1 / 255, d2 / 255];
            const v1 = [...[nl[0], nl[1], nl[2]].map((x) => x / 255), ...(hasAlpha ? [nl[3] / 255] : []), nd[0] / 255, nd[1] / 255, nd[2] / 255];
            const curves = pruneLinear(readCurve4(r, vc));
            keys[keys.length - 1].curves = curves;
            time = time2; [l0, l1, l2, l3] = nl; [d0, d1, d2] = nd;
          }
          st.twoColor = keys;
        } else if (type === 5) {
          // alpha
          const keys: typeof st.alpha = [];
          let time = r.float();
          let a = r.byte();
          for (let f = 0; ; f++) {
            keys.push({ time, value: a / 255, curves: undefined });
            if (f === frameCount - 1) break;
            const time2 = r.float();
            const a2 = r.byte();
            const curve = pruneLinear(readCurve4(r, 1));
            keys[keys.length - 1].curves = curve;
            time = time2; a = a2;
          }
          st.alpha = keys;
        } else {
          throw new Error(`未知的槽位时间轴类型：${type}`);
        }
      }
    }
  }

  /* 骨骼时间轴 */
  const boneTlCount = r.varint();
  for (let i = 0; i < boneTlCount; i++) {
    const bIndex = r.varint();
    const bName = boneIdx.get(bIndex) ?? `bone${bIndex}`;
    const bt = anim.bone[bName] ??= {};
    const tlCount = r.varint();
    for (let k = 0; k < tlCount; k++) {
      const type = r.byte();
      const frameCount = r.varint();
      if (!is4) {
        /* 3.x：rotate=0 / translate=1 / scale=2 / shear=3 */
        if (type === 0) {
          const keys: NonNullable<typeof bt.rotate> = [];
          for (let f = 0; f < frameCount; f++) {
            const time = r.float(), angle = r.float();
            const curve = f < frameCount - 1 ? readCurve3x(r) : null;
            keys.push({ time, angle, curves: curve ? [curve] : undefined });
          }
          bt.rotate = keys;
        } else {
          const keys: NonNullable<typeof bt.translate> = [];
          for (let f = 0; f < frameCount; f++) {
            const time = r.float(), x = r.float(), y = r.float();
            const curve = f < frameCount - 1 ? readCurve3x(r) : null;
            keys.push({ time, x, y, curves: curve ? [curve, curve] : undefined });
          }
          if (type === 1) bt.translate = keys;
          else if (type === 2) bt.scale = keys;
          else if (type === 3) bt.shear = keys;
          else throw new Error(`未知的骨骼时间轴类型：${type}`);
        }
      } else {
        /* 4.x：0-10 */
        if (type === 10) {
          // inherit（4.2）
          const keys: NonNullable<typeof bt.inherit> = [];
          for (let f = 0; f < frameCount; f++) {
            const time = r.float();
            const inherit = TRANSFORM_MODES[r.byte()] ?? 'normal';
            keys.push({ time, inherit });
          }
          bt.inherit = keys;
          continue;
        }
        const bezierCount = r.varint();
        void bezierCount;
        if (type === 0) {
          // rotate（单值）
          const keys: NonNullable<typeof bt.rotate> = [];
          let time = r.float(), angle = r.float();
          for (let f = 0; ; f++) {
            keys.push({ time, angle, curves: undefined });
            if (f === frameCount - 1) break;
            const time2 = r.float(), angle2 = r.float();
            const curve = pruneLinear(readCurve4(r, 1));
            keys[keys.length - 1].curves = curve;
            time = time2; angle = angle2;
          }
          bt.rotate = keys;
        } else if (type === 1 || type === 4 || type === 7) {
          // translate / scale / shear（双值）
          const keys: NonNullable<typeof bt.translate> = [];
          let time = r.float(), x = r.float(), y = r.float();
          for (let f = 0; ; f++) {
            keys.push({ time, x, y, curves: undefined });
            if (f === frameCount - 1) break;
            const time2 = r.float(), x2 = r.float(), y2 = r.float();
            const curves = pruneLinear(readCurve4(r, 2));
            keys[keys.length - 1].curves = curves;
            time = time2; x = x2; y = y2;
          }
          if (type === 1) bt.translate = keys;
          else if (type === 4) bt.scale = keys;
          else bt.shear = keys;
        } else {
          // 单轴：2=translatex 3=translatey 5=scalex 6=scaley 8=shearx 9=sheary
          const keys: NonNullable<typeof bt.translatex> = [];
          let time = r.float(), v = r.float();
          for (let f = 0; ; f++) {
            keys.push({ time, value: v, curves: undefined });
            if (f === frameCount - 1) break;
            const time2 = r.float(), v2 = r.float();
            const curve = pruneLinear(readCurve4(r, 1));
            keys[keys.length - 1].curves = curve;
            time = time2; v = v2;
          }
          if (type === 2) bt.translatex = keys;
          else if (type === 3) bt.translatey = keys;
          else if (type === 5) bt.scalex = keys;
          else if (type === 6) bt.scaley = keys;
          else if (type === 8) bt.shearx = keys;
          else if (type === 9) bt.sheary = keys;
          else throw new Error(`未知的骨骼时间轴类型：${type}`);
        }
      }
    }
  }

  /* IK 时间轴 */
  const ikCount = r.varint();
  for (let i = 0; i < ikCount; i++) {
    const index = r.varint();
    const cname = ir.ik[index]?.name ?? `ik${index}`;
    const frameCount = r.varint();
    if (b.flagsConstraints) {
      /* 4.2 flags 版：index、frameCount、bezierCount，然后逐帧 flags+time+值 */
      const bezierCountTotal = r.varint();
      void bezierCountTotal;
      const keys: NonNullable<typeof anim.ik[string]> = [];
      let flags = r.byte();
      let time = r.float();
      let mix = (flags & 1) !== 0 ? ((flags & 2) !== 0 ? r.float() : 1) : 0;
      let softness = (flags & 4) !== 0 ? r.float() : 0;
      for (let f = 0; ; f++) {
        keys.push({
          time, mix, softness,
          bendDirection: (flags & 8) !== 0 ? 1 : -1,
          compress: (flags & 16) !== 0,
          stretch: (flags & 32) !== 0,
          curves: undefined,
        });
        if (f === frameCount - 1) break;
        flags = r.byte();
        const time2 = r.float();
        const mix2 = (flags & 1) !== 0 ? ((flags & 2) !== 0 ? r.float() : 1) : 0;
        const softness2 = (flags & 4) !== 0 ? r.float() : 0;
        let curves: Curve[] | undefined;
        if ((flags & 64) !== 0) curves = [{ stepped: true }, { stepped: true }];
        else if ((flags & 128) !== 0) {
          /* 4.2：贝塞尔为绝对坐标，原生保留 */
          curves = pruneLinear([
            { bezier: [r.float(), r.float(), r.float(), r.float()] },
            { bezier: [r.float(), r.float(), r.float(), r.float()] },
          ]);
        }
        keys[keys.length - 1].curves = curves;
        time = time2; mix = mix2; softness = softness2;
      }
      anim.ik[cname] = keys;
    } else if (is4) {
      /* 4.0/4.1：time, mix, softness 浮点 + bendDir 字节 + compress/stretch 布尔 */
      const bezierCount = r.varint();
      void bezierCount;
      const keys: NonNullable<typeof anim.ik[string]> = [];
      let time = r.float(), mix = r.float(), softness = r.float();
      for (let f = 0; ; f++) {
        const bendDirection = (r.sbyte() as 1 | -1);
        const compress = r.boolean(), stretch = r.boolean();
        keys.push({ time, mix, softness, bendDirection, compress, stretch, curves: undefined });
        if (f === frameCount - 1) break;
        const time2 = r.float(), mix2 = r.float(), softness2 = r.float();
        const curves = pruneLinear(readCurve4(r, 2));
        keys[keys.length - 1].curves = curves;
        time = time2; mix = mix2; softness = softness2;
      }
      anim.ik[cname] = keys;
    } else {
      /* 3.x */
      const keys: NonNullable<typeof anim.ik[string]> = [];
      for (let f = 0; f < frameCount; f++) {
        const time = r.float(), mix = r.float();
        let softness = 0;
        if (b.hasIkSoftness) softness = r.float();
        const bendDirection = (r.sbyte() as 1 | -1);
        let compress = false, stretch = false;
        if (b.hasIkStretch) { compress = r.boolean(); stretch = r.boolean(); }
        const curve = f < frameCount - 1 ? readCurve3x(r) : null;
        keys.push({
          time, mix, softness, bendDirection, compress, stretch,
          curves: curve ? [curve, curve] : undefined,
        });
      }
      anim.ik[cname] = keys;
    }
  }

  /* 变换约束时间轴 */
  const tfCount = r.varint();
  for (let i = 0; i < tfCount; i++) {
    const index = r.varint();
    const cname = ir.transform[index]?.name ?? `transform${index}`;
    const frameCount = r.varint();
    if (is4) {
      const bezierCount = r.varint();
      void bezierCount;
      const keys: NonNullable<typeof anim.transform[string]> = [];
      let time = r.float();
      let v = [r.float(), r.float(), r.float(), r.float(), r.float(), r.float()];
      for (let f = 0; ; f++) {
        keys.push({
          time, mixRotate: v[0], mixX: v[1], mixY: v[2],
          mixScaleX: v[3], mixScaleY: v[4], mixShearY: v[5], curves: undefined,
        });
        if (f === frameCount - 1) break;
        const time2 = r.float();
        const v2 = [r.float(), r.float(), r.float(), r.float(), r.float(), r.float()];
        const curves = pruneLinear(readCurve4(r, 6));
        keys[keys.length - 1].curves = curves;
        time = time2; v = v2;
      }
      anim.transform[cname] = keys;
    } else {
      const keys: NonNullable<typeof anim.transform[string]> = [];
      for (let f = 0; f < frameCount; f++) {
        const time = r.float();
        const mixRotate = r.float(), mixX = r.float(), mixScaleX = r.float(), mixShearY = r.float();
        const curve = f < frameCount - 1 ? readCurve3x(r) : null;
        keys.push({
          time, mixRotate, mixX, mixY: mixX, mixScaleX, mixScaleY: mixScaleX, mixShearY,
          curves: curve ? Array(6).fill(curve) : undefined,
        });
      }
      anim.transform[cname] = keys;
    }
  }

  /* 路径约束时间轴 */
  const pathCount = r.varint();
  for (let i = 0; i < pathCount; i++) {
    const index = r.varint();
    const cname = ir.path[index]?.name ?? `path${index}`;
    const pt = anim.path[cname] ??= {};
    const tlCount = r.varint();
    for (let k = 0; k < tlCount; k++) {
      const type = r.byte();
      const frameCount = r.varint();
      readPathTimeline(r, type, frameCount, pt, is4, b);
    }
  }

  /* 物理时间轴（4.2） */
  if (b.hasPhysics) {
    const phCount = r.varint();
    for (let i = 0; i < phCount; i++) {
      const index0 = r.varint();
      const cname = index0 === 0 ? '' : (ir.physics[index0 - 1]?.name ?? `physics${index0 - 1}`);
      const pt = anim.physics[cname] ??= {};
      const tlCount = r.varint();
      for (let k = 0; k < tlCount; k++) {
        const type = r.byte();
        const frameCount = r.varint();
        if (type === 8) {
          pt.reset = [];
          for (let f = 0; f < frameCount; f++) pt.reset.push({ time: r.float() });
          continue;
        }
        const bezierCount = r.varint();
        void bezierCount;
        const field = ({ 0: 'inertia', 1: 'strength', 2: 'damping', 4: 'mass', 5: 'wind', 6: 'gravity', 7: 'mix' } as Record<number, string>)[type];
        if (!field) throw new Error(`未知的物理时间轴类型：${type}`);
        const keys: { time: number; value: number; curves?: Curve[] }[] = [];
        let time = r.float(), v = r.float();
        for (let f = 0; ; f++) {
          keys.push({ time, value: v, curves: undefined });
          if (f === frameCount - 1) break;
          const time2 = r.float(), v2 = r.float();
          const curve = pruneLinear(readCurve4(r, 1));
          keys[keys.length - 1].curves = curve;
          time = time2; v = v2;
        }
        (pt as unknown as Record<string, unknown>)[field] = keys;
      }
    }
  }

  /* 附件（deform / sequence）时间轴 */
  const attachCount = r.varint();
  for (let i = 0; i < attachCount; i++) {
    const skinIndex = r.varint();
    const skin = skins[skinIndex];
    const skinName = skin?.name ?? `skin${skinIndex}`;
    const slotCount2 = r.varint();
    for (let k = 0; k < slotCount2; k++) {
      const slotIndex = r.varint();
      const slotName = slotIdx.get(slotIndex) ?? `slot${slotIndex}`;
      const attCount = r.varint();
      for (let m = 0; m < attCount; m++) {
        const attName = b.hasStrTable ? (r.stringRef() ?? '') : (r.string() ?? '');
        let timelineType = 0; // 4.0 及 3.x：仅 deform
        let frameCount: number;
        if (b.hasAttachTypeByte) {
          timelineType = r.byte();
          frameCount = r.varint();
        } else {
          frameCount = r.varint();
        }
        if (timelineType === 1) {
          /* sequence（4.1+） */
          const keys: SequenceKey[] = [];
          for (let f = 0; f < frameCount; f++) {
            const time = r.float();
            const modeAndIndex = r.int32();
            const mode = SEQUENCE_MODES[modeAndIndex & 0xf] ?? 'hold';
            const index = modeAndIndex >> 4;
            const delay = r.float();
            keys.push({ time, delay, mode, index });
          }
          const seqSlot = (anim.sequence[skinName] ??= {});
          const seqAtt = (seqSlot[slotName] ??= {});
          seqAtt[attName] = keys;
          continue;
        }
        /* deform */
        let bezierCount = 0;
        if (b.hasBezierCount) bezierCount = r.varint();
        void bezierCount;
        const keys: DeformKey[] = [];
        if (is4) {
          /* 4.x：[t0, block0], [t1, curve0, block1], ... */
          let time = r.float();
          for (let f = 0; ; f++) {
            const end = r.varint();
            let vertices: number[] | null = null;
            let offset = 0;
            if (end !== 0) {
              offset = r.varint();
              const count = end;
              vertices = r.floatArray(count);
            }
            keys.push({ time, vertices, offset, curve: null });
            if (f === frameCount - 1) break;
            const time2 = r.float();
            const curve: Curve = (() => {
              const t = r.byte();
              if (t === 1) return { stepped: true };
              if (t === 2) return { bezier: [r.float(), r.float(), r.float(), r.float()] };
              return null;
            })();
            keys[keys.length - 1].curve = curve;
            time = time2;
          }
        } else {
          /* 3.x：[t0, block0, curve0], [t1, block1, curve1], ... */
          for (let f = 0; f < frameCount; f++) {
            const time = r.float();
            const end = r.varint();
            let vertices: number[] | null = null;
            let offset = 0;
            if (end !== 0) {
              offset = r.varint();
              vertices = r.floatArray(end);
            }
            const curve = f < frameCount - 1 ? readCurve3x(r) : null;
            keys.push({ time, vertices, offset, curve });
          }
        }
        const dSkin = (anim.deform[skinName] ??= {});
        const dSlot = (dSkin[slotName] ??= {});
        dSlot[attName] = keys;
      }
    }
  }

  /* drawOrder */
  const drawOrderCount = r.varint();
  if (drawOrderCount > 0) {
    for (let i = 0; i < drawOrderCount; i++) {
      const time = r.float();
      const offsetCount = r.varint();
      const offsets: import('./types').DrawOrderKey['offsets'] = offsetCount > 0 ? [] : null;
      for (let k = 0; k < offsetCount; k++) {
        const slotIndex = r.varint();
        /* 官方以 int32 语义读取偏移（负数以 2^32 补码存储），回绕为有符号 */
        const offset = r.varint() | 0;
        offsets!.push({ slot: slotIdx.get(slotIndex) ?? `slot${slotIndex}`, offset });
      }
      anim.drawOrder.push({ time, offsets });
    }
  }

  /* 事件 */
  const eventCount = r.varint();
  if (eventCount > 0) {
    for (let i = 0; i < eventCount; i++) {
      const time = r.float();
      const eIndex = r.varint();
      const def = ir.events[eIndex];
      const int = r.varintZ();
      const float = r.float();
      let string: string | undefined;
      if (b.eventStringNoBool) {
        string = r.string() ?? undefined;
      } else {
        string = r.boolean() ? (r.string() ?? '') : undefined;
      }
      let volume: number | undefined;
      let balance: number | undefined;
      if (b.hasEventAudio && def?.audio != null) {
        volume = r.float();
        balance = r.float();
      }
      anim.events.push({
        time, name: def?.name ?? `event${eIndex}`,
        int, float, string: string ?? def?.string,
        volume, balance,
      });
    }
  }

  return anim;
}

function readColorBytes(r: BinReader, hasAlpha: boolean): number[] {
  const v = [r.byte(), r.byte(), r.byte()];
  if (hasAlpha) v.push(r.byte());
  return v;
}

/** 4.x 逐值曲线：曲线字节 + 每值 4 浮点（绝对坐标，原生保留；null 表示无端点场景） */
function readCurve4(r: BinReader, valueCount: number): Curve[] {
  const t = r.byte();
  if (t === 1) return Array.from({ length: valueCount }, () => ({ stepped: true }) as Curve);
  if (t === 2) {
    const out: Curve[] = [];
    for (let i = 0; i < valueCount; i++) {
      out.push({ bezier: [r.float(), r.float(), r.float(), r.float()] });
    }
    return out;
  }
  return Array.from({ length: valueCount }, () => null);
}

function readPathTimeline(
  r: BinReader, type: number, frameCount: number,
  pt: NonNullable<import('./types').AnimationIR['path'][string]>,
  is4: boolean, b: import('./spec').VersionProfile['bin'],
): void {
  if (type === 0 || type === 1) {
    // position / spacing
    if (is4) {
      const bezierCount = r.varint();
      void bezierCount;
      const keys: { time: number; value: number; curves?: Curve[] }[] = [];
      let time = r.float(), v = r.float();
      for (let f = 0; ; f++) {
        keys.push({ time, value: v, curves: undefined });
        if (f === frameCount - 1) break;
        const time2 = r.float(), v2 = r.float();
        const curve = pruneLinear(readCurve4(r, 1));
        keys[keys.length - 1].curves = curve;
        time = time2; v = v2;
      }
      if (type === 0) pt.position = keys; else pt.spacing = keys;
    } else {
      const keys: { time: number; value: number; curves?: Curve[] }[] = [];
      for (let f = 0; f < frameCount; f++) {
        const time = r.float(), v = r.float();
        const curve = f < frameCount - 1 ? readCurve3x(r) : null;
        keys.push({ time, value: v, curves: curve ? [curve] : undefined });
      }
      if (type === 0) pt.position = keys; else pt.spacing = keys;
    }
  } else if (type === 2) {
    // mix
    if (is4) {
      const bezierCount = r.varint();
      void bezierCount;
      const keys: NonNullable<typeof pt.mix> = [];
      let time = r.float();
      let v = [r.float(), r.float(), r.float()];
      for (let f = 0; ; f++) {
        keys.push({ time, mixRotate: v[0], mixX: v[1], mixY: v[2], curves: undefined });
        if (f === frameCount - 1) break;
        const time2 = r.float();
        const v2 = [r.float(), r.float(), r.float()];
        const curves = pruneLinear(readCurve4(r, 3));
        keys[keys.length - 1].curves = curves;
        time = time2; v = v2;
      }
      pt.mix = keys;
    } else {
      const keys: NonNullable<typeof pt.mix> = [];
      for (let f = 0; f < frameCount; f++) {
        const time = r.float();
        const mixRotate = r.float(), mixX = r.float();
        const curve = f < frameCount - 1 ? readCurve3x(r) : null;
        keys.push({
          time, mixRotate, mixX, mixY: mixX,
          curves: curve ? [curve, curve, curve] : undefined,
        });
      }
      pt.mix = keys;
    }
  } else {
    throw new Error(`未知的路径时间轴类型：${type}`);
  }
  void b;
}
