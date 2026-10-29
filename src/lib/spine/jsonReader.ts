/**
 * JSON 解析器 —— 容忍式读取任意 3.2~4.2 版本的 Spine JSON 导出文件 → IR。
 * 字段名冲突处（如 rotateMix vs mixRotate）按存在性自动识别，不依赖版本号。
 */
import {
  type SkeletonIR, type BoneIR, type SlotIR, type IkIR, type TransformIR, type PathIR,
  type PhysicsIR, type SkinIR, type AttachmentIR, type EventDefIR, type AnimationIR,
  type VerticesIR, type SequenceIR, type DeformKey, type SequenceKey, type SequenceMode,
  type TransformMode, type BlendMode, type Curve, type SpineVersion,
} from './types';
import { curveFromJson, hexToRgba } from './color';

type J = Record<string, unknown>;

const num = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : d);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): J => (v != null && typeof v === 'object' && !Array.isArray(v) ? v as J : {});
const nums = (v: unknown): number[] => arr(v).map((x) => num(x));

const TRANSFORM_MODES: TransformMode[] = [
  'normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection',
];
const SEQUENCE_MODES: SequenceMode[] = [
  'hold', 'once', 'loop', 'pingpong', 'onceReverse', 'loopReverse', 'pingpongReverse',
];

export interface JsonReadResult {
  ir: SkeletonIR;
}

export function readJson(text: string, sourceVersion: SpineVersion | null): SkeletonIR {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失败：${(e as Error).message}`);
  }
  const r = obj(root);
  if (!('bones' in r)) throw new Error('JSON 缺少 bones 节，不是 Spine 骨骼数据文件');

  const skel = obj(r.skeleton);
  const ir: SkeletonIR = {
    hash: str(skel.hash),
    version: str(skel.spine) ?? '',
    x: num(skel.x), y: num(skel.y),
    width: num(skel.width), height: num(skel.height),
    fps: num(skel.fps, 30),
    imagesPath: str(skel.images),
    audioPath: str(skel.audio),
    referenceScale: num(skel.referenceScale, 100),
    /* 4.x 源：曲线为绝对坐标（时间/值），按原生空间保留；写出时统一转换 */
    curveSpace: sourceVersion && sourceVersion.startsWith('4.') ? 'abs' : 'norm',
    bones: [], slots: [], ik: [], transform: [], path: [], physics: [],
    defaultSkin: null, skins: [], events: [], animations: [],
  };

  /* ---------- 骨骼 ---------- */
  const boneByName = new Map<string, BoneIR>();
  for (const bm of arr(r.bones)) {
    const b = obj(bm);
    const name = str(b.name) ?? `bone${ir.bones.length}`;
    const bone: BoneIR = {
      name,
      parent: str(b.parent),
      length: num(b.length), rotation: num(b.rotation),
      x: num(b.x), y: num(b.y),
      scaleX: num(b.scaleX, 1), scaleY: num(b.scaleY, 1),
      shearX: num(b.shearX), shearY: num(b.shearY),
      transformMode: 'normal',
      color: str(b.color),
    };
    if (typeof b.transform === 'string' && TRANSFORM_MODES.includes(b.transform as TransformMode)) {
      bone.transformMode = b.transform as TransformMode;
    } else if (typeof b.inherit === 'string' && TRANSFORM_MODES.includes(b.inherit as TransformMode)) {
      /* 4.2：骨骼继承模式键名从 transform 改为 inherit，枚举值不变 */
      bone.transformMode = b.inherit as TransformMode;
    } else {
      // 3.4 及更早：inheritRotation / inheritScale
      const inhR = bool(b.inheritRotation, true);
      const inhS = bool(b.inheritScale, true);
      bone.inheritRotation = inhR; bone.inheritScale = inhS;
      bone.transformMode = inhR && inhS ? 'normal'
        : !inhR && !inhS ? 'onlyTranslation'
        : !inhR ? 'noRotationOrReflection' : 'noScale';
    }
    if ('skin' in b) bone.skinRequired = bool(b.skin, false);
    if (b.icon != null) bone.icon = str(b.icon);
    boneByName.set(name, bone);
    ir.bones.push(bone);
  }

  /* ---------- 槽位 ---------- */
  for (const sm of arr(r.slots)) {
    const s = obj(sm);
    ir.slots.push({
      name: str(s.name) ?? `slot${ir.slots.length}`,
      bone: str(s.bone) ?? '',
      color: str(s.color) ?? 'ffffffff',
      dark: str(s.dark) ?? undefined,
      attachment: str(s.attachment),
      blend: (typeof s.blend === 'string' ? s.blend : 'normal') as BlendMode,
    });
  }
  const slotIndex = new Map(ir.slots.map((s, i) => [s.name, i]));

  /* ---------- IK 约束 ---------- */
  for (const cm of arr(r.ik)) {
    const c = obj(cm);
    ir.ik.push({
      name: str(c.name) ?? `ik${ir.ik.length}`,
      order: num(c.order),
      skinRequired: 'skin' in c ? bool(c.skin, false) : false,
      bones: arr(c.bones).map((b) => String(b)),
      target: str(c.target) ?? '',
      mix: num(c.mix, 1),
      softness: num(c.softness, 0),
      bendDirection: bool(c.bendPositive, true) ? 1 : -1,
      compress: bool(c.compress, false),
      stretch: bool(c.stretch, false),
      uniform: bool(c.uniform, false),
    });
  }

  /* ---------- 变换约束 ---------- */
  for (const cm of arr(r.transform)) {
    const c = obj(cm);
    ir.transform.push({
      name: str(c.name) ?? `transform${ir.transform.length}`,
      order: num(c.order),
      skinRequired: 'skin' in c ? bool(c.skin, false) : false,
      bones: arr(c.bones).map((b) => String(b)),
      target: str(c.target) ?? '',
      local: bool(c.local, false),
      relative: bool(c.relative, false),
      offsetRotation: num(c.rotation),
      offsetX: num(c.x), offsetY: num(c.y),
      offsetScaleX: num(c.scaleX), offsetScaleY: num(c.scaleY),
      offsetShearY: num(c.shearY),
      mixRotate: num(c.mixRotate, num(c.rotateMix, 1)),
      mixX: num(c.mixX, num(c.translateMix, 1)),
      mixY: num(c.mixY, num(c.mixX, num(c.translateMix, 1))),
      mixScaleX: num(c.mixScaleX, num(c.scaleMix, 1)),
      mixScaleY: num(c.mixScaleY, num(c.mixScaleX, num(c.scaleMix, 1))),
      mixShearY: num(c.mixShearY, num(c.shearMix, 1)),
    });
  }

  /* ---------- 路径约束 ---------- */
  for (const cm of arr(r.path)) {
    const c = obj(cm);
    ir.path.push({
      name: str(c.name) ?? `path${ir.path.length}`,
      order: num(c.order),
      skinRequired: 'skin' in c ? bool(c.skin, false) : false,
      bones: arr(c.bones).map((b) => String(b)),
      target: str(c.target) ?? '',
      positionMode: (str(c.positionMode) ?? 'percent') as 'fixed' | 'percent',
      spacingMode: (str(c.spacingMode) ?? 'length') as 'fixed' | 'length' | 'percent',
      rotateMode: (str(c.rotateMode) ?? 'tangent') as 'tangent' | 'chain' | 'chainScale',
      offsetRotation: num(c.rotation),
      position: num(c.position),
      spacing: num(c.spacing),
      mixRotate: num(c.mixRotate, num(c.rotateMix, 1)),
      mixX: num(c.mixX, num(c.translateMix, 1)),
      mixY: num(c.mixY, num(c.mixX, num(c.translateMix, 1))),
    });
  }

  /* ---------- 物理约束（4.2） ---------- */
  for (const cm of arr(r.physics)) {
    const c = obj(cm);
    ir.physics.push({
      name: str(c.name) ?? `physics${ir.physics.length}`,
      order: num(c.order),
      skinRequired: 'skin' in c ? bool(c.skin, false) : false,
      bone: str(c.bone) ?? '',
      x: num(c.x), y: num(c.y),
      rotate: num(c.rotate), scaleX: num(c.scaleX), shearX: num(c.shearX),
      limit: num(c.limit, 5000), fps: num(c.fps, 60),
      inertia: num(c.inertia, 1), strength: num(c.strength, 100),
      damping: num(c.damping, 1), mass: num(c.mass, 1),
      wind: num(c.wind), gravity: num(c.gravity), mix: num(c.mix, 1),
      inertiaGlobal: bool(c.inertiaGlobal, false),
      strengthGlobal: bool(c.strengthGlobal, false),
      dampingGlobal: bool(c.dampingGlobal, false),
      massGlobal: bool(c.massGlobal, false),
      windGlobal: bool(c.windGlobal, false),
      gravityGlobal: bool(c.gravityGlobal, false),
      mixGlobal: bool(c.mixGlobal, false),
    });
  }

  /* ---------- 皮肤 ---------- */
  const readSkin = (name: string, body: J, meta: J): SkinIR => {
    const skin: SkinIR = {
      name,
      bones: arr(meta.bones).map(String),
      constraints: {
        ik: arr(meta.ik).map(String),
        transform: arr(meta.transform).map(String),
        path: arr(meta.path).map(String),
        physics: arr(meta.physics).map(String),
      },
      entries: [],
      color: str(meta.color),
    };
    // 3.2~3.7：body 即 {slot: {att}}；3.8+：meta.attachments 为 {slot: {att}}
    const attMap = obj(meta.attachments ?? body);
    for (const [slotName, slotAtts] of Object.entries(attMap)) {
      const sa = obj(slotAtts);
      for (const [attName, attRaw] of Object.entries(sa)) {
        const a = obj(attRaw);
        skin.entries.push({
          slot: slotName,
          name: attName,
          attachment: readAttachment(a, attName, slotName, slotIndex),
        });
      }
    }
    return skin;
  };

  const skinsRaw = r.skins;
  if (Array.isArray(skinsRaw)) {
    // 3.8+ 数组形式
    for (const sRaw of skinsRaw) {
      const s = obj(sRaw);
      const name = str(s.name) ?? 'default';
      const skin = readSkin(name, {}, s);
      if (name === 'default' && ir.defaultSkin == null) ir.defaultSkin = skin;
      else ir.skins.push(skin);
    }
  } else if (skinsRaw != null && typeof skinsRaw === 'object') {
    // 3.2~3.7 对象形式
    for (const [name, bodyRaw] of Object.entries(skinsRaw as J)) {
      const skin = readSkin(name, obj(bodyRaw), {});
      if (name === 'default' && ir.defaultSkin == null) ir.defaultSkin = skin;
      else ir.skins.push(skin);
    }
  }

  /* ---------- 事件 ---------- */
  for (const [name, eRaw] of Object.entries(obj(r.events))) {
    const e = obj(eRaw);
    ir.events.push({
      name,
      int: num(e.int), float: num(e.float),
      string: str(e.string) ?? '',
      audio: str(e.audio),
      volume: num(e.volume, 1),
      balance: num(e.balance, 0),
    });
  }

  /* ---------- 动画 ---------- */
  for (const [name, aRaw] of Object.entries(obj(r.animations))) {
    ir.animations.push(readAnimation(name, obj(aRaw), ir, slotIndex));
  }

  return ir;
}

/* ---------------- 附件 ---------------- */

function readVerticesPacked(v: unknown, vertexCount: number): VerticesIR {
  const flat = nums(v);
  if (flat.length === vertexCount * 2) {
    return { weighted: false, vertices: flat };
  }
  // 加权打包形式：[n, idx,x,y,w, ...] → 内部形态
  const bones: number[] = [];
  const weights: number[] = [];
  let i = 0;
  while (i < flat.length) {
    const n = Math.max(0, Math.round(flat[i])); i += 1;
    bones.push(n);
    for (let k = 0; k < n && i + 3 < flat.length + 1; k++) {
      if (i + 3 >= flat.length + 1) break;
      bones.push(Math.round(flat[i]));
      weights.push(flat[i + 1], flat[i + 2], flat[i + 3]);
      i += 4;
    }
  }
  return { weighted: true, vertices: weights, bones };
}

function readSequence(m: unknown): SequenceIR | null {
  const s = obj(m);
  if (s.count == null) return null;
  return {
    count: num(s.count),
    start: num(s.start, 1),
    digits: num(s.digits, 0),
    setup: num(s.setup, 0),
  };
}

function readAttachment(a: J, keyName: string, slotName: string, slotIndex: Map<string, number>): AttachmentIR {
  const name = str(a.name) ?? keyName;
  const type = str(a.type) ?? 'region';
  const common = { name };
  switch (type) {
    case 'region':
      return {
        ...common, type: 'region',
        path: str(a.path) ?? name,
        rotation: num(a.rotation), x: num(a.x), y: num(a.y),
        scaleX: num(a.scaleX, 1), scaleY: num(a.scaleY, 1),
        width: num(a.width), height: num(a.height),
        color: str(a.color),
        sequence: readSequence(a.sequence),
      };
    case 'boundingbox':
      return {
        ...common, type: 'boundingbox',
        verts: readVerticesPacked(a.vertices, num(a.vertexCount, nums(a.vertices).length / 2)),
        color: str(a.color),
      };
    case 'mesh': {
      const uvs = nums(a.uvs);
      const vc = uvs.length / 2;
      const edges = a.edges != null ? nums(a.edges).map((n) => Math.round(n)) : null;
      return {
        ...common, type: 'mesh',
        path: str(a.path) ?? name,
        uvs, triangles: nums(a.triangles).map((n) => Math.round(n)),
        verts: readVerticesPacked(a.vertices, vc),
        hull: num(a.hull) ? Math.round(num(a.hull)) : 0,
        edges: edges && edges.length ? edges : null,
        width: num(a.width), height: num(a.height),
        color: str(a.color),
        sequence: readSequence(a.sequence),
      };
    }
    case 'linkedmesh':
      return {
        ...common, type: 'linkedmesh',
        path: str(a.path) ?? name,
        skin: str(a.skin),
        parent: str(a.parent) ?? '',
        deform: bool(a.deform, true),
        width: num(a.width), height: num(a.height),
        color: str(a.color),
        sequence: readSequence(a.sequence),
      };
    case 'path': {
      const vc = num(a.vertexCount);
      return {
        ...common, type: 'path',
        closed: bool(a.closed, false),
        constantSpeed: bool(a.constantSpeed, true),
        vertexCount: vc,
        verts: readVerticesPacked(a.vertices, vc),
        lengths: nums(a.lengths),
        color: str(a.color),
      };
    }
    case 'point':
      return {
        ...common, type: 'point',
        rotation: num(a.rotation), x: num(a.x), y: num(a.y),
        color: str(a.color),
      };
    case 'clipping': {
      const vc = num(a.vertexCount);
      return {
        ...common, type: 'clipping',
        end: str(a.end) ?? '',
        vertexCount: vc,
        verts: readVerticesPacked(a.vertices, vc),
        color: str(a.color),
      };
    }
    default:
      // 未知类型按区域处理（保留最接近的降级形态）
      return {
        ...common, type: 'region',
        path: str(a.path),
        rotation: num(a.rotation), x: num(a.x), y: num(a.y),
        scaleX: num(a.scaleX, 1), scaleY: num(a.scaleY, 1),
        width: num(a.width), height: num(a.height),
        color: str(a.color),
        sequence: null,
      };
  }
}

/* ---------------- 动画 ---------------- */

function readAnimation(name: string, a: J, ir: SkeletonIR, slotIndex: Map<string, number>): AnimationIR {
  const anim: AnimationIR = {
    name, bone: {}, slot: {}, ik: {}, transform: {}, path: {}, physics: {},
    deform: {}, sequence: {}, drawOrder: [], events: [],
  };

  /* 槽位时间轴 */
  for (const [slotName, tRaw] of Object.entries(obj(a.slots))) {
    const t = obj(tRaw);
    const st: AnimationIR['slot'][string] = {};
    if (t.attachment != null) {
      st.attachment = arr(t.attachment).map((k) => {
        const km = obj(k);
        return { time: num(km.time), name: str(km.name) };
      });
    }
    const readColorKeys = (keys: unknown[], field: string, valueCount: number) =>
      keys.map((k) => {
        const km = obj(k);
        const hex = str(km[field]) ?? 'ffffffff';
        return { time: num(km.time), color: hex.length === 6 ? hex + 'ff' : hex, curves: curveFromJson(km, valueCount) };
      });
    if (t.color != null) st.color = readColorKeys(arr(t.color), 'color', 4);
    if (t.rgba != null) st.color = readColorKeys(arr(t.rgba), 'color', 4);
    if (t.rgb != null) {
      // 无 alpha：以槽位 setup alpha 补全
      const setup = ir.slots[slotIndex.get(slotName) ?? 0];
      const setupAlpha = setup ? hexToRgba(setup.color)[3] : 255;
      st.color = arr(t.rgb).map((k) => {
        const km = obj(k);
        const hex = str(km.color) ?? 'ffffff';
        return {
          time: num(km.time),
          color: (hex.length === 6 ? hex : hex.slice(0, 6)) + Math.round(setupAlpha).toString(16).padStart(2, '0'),
          curves: curveFromJson(km, 3),
        };
      });
    }
    if (t.alpha != null) {
      st.alpha = arr(t.alpha).map((k) => {
        const km = obj(k);
        return { time: num(km.time), value: num(km.value, num(km.alpha, 0)), curves: curveFromJson(km, 1) };
      });
    }
    const readTwoColor = (keys: unknown[], hasAlpha: boolean, valueCount: number) =>
      keys.map((k) => {
        const km = obj(k);
        let light = str(km.light) ?? 'ffffffff';
        if (light.length === 6) light += 'ff';
        const dark = (str(km.dark) ?? 'ffffff').slice(0, 6);
        return { time: num(km.time), light, dark, curves: curveFromJson(km, valueCount) };
      });
    if (t.twoColor != null) st.twoColor = readTwoColor(arr(t.twoColor), true, 7);
    if (t.rgba2 != null) st.twoColor = readTwoColor(arr(t.rgba2), true, 7);
    if (t.rgb2 != null) st.twoColor = readTwoColor(arr(t.rgb2), false, 6);
    anim.slot[slotName] = st;
  }

  /* 骨骼时间轴 */
  for (const [boneName, tRaw] of Object.entries(obj(a.bones))) {
    const t = obj(tRaw);
    const bt: AnimationIR['bone'][string] = {};
    const keys1 = (raw: unknown, field: string, dflt: number) =>
      arr(raw).map((k) => {
        const km = obj(k);
        return { time: num(km.time), value: num(km.value, num(km[field], dflt)), curves: curveFromJson(km, 1) };
      });
    const keys2 = (raw: unknown, dfltX: number, dfltY: number) =>
      arr(raw).map((k) => {
        const km = obj(k);
        return {
          time: num(km.time),
          x: num(km.x, dfltX), y: num(km.y, dfltY),
          curves: curveFromJson(km, 2),
        };
      });
    if (t.rotate != null) {
      bt.rotate = arr(t.rotate).map((k) => {
        const km = obj(k);
        return { time: num(km.time), angle: num(km.angle, num(km.value, 0)), curves: curveFromJson(km, 1) };
      });
    }
    if (t.translate != null) bt.translate = keys2(t.translate, 0, 0);
    if (t.translatex != null) bt.translatex = keys1(t.translatex, 'x', 0);
    if (t.translatey != null) bt.translatey = keys1(t.translatey, 'y', 0);
    if (t.scale != null) bt.scale = keys2(t.scale, 1, 1);
    if (t.scalex != null) bt.scalex = keys1(t.scalex, 'x', 1);
    if (t.scaley != null) bt.scaley = keys1(t.scaley, 'y', 1);
    if (t.shear != null) bt.shear = keys2(t.shear, 0, 0);
    if (t.shearx != null) bt.shearx = keys1(t.shearx, 'x', 0);
    if (t.sheary != null) bt.sheary = keys1(t.sheary, 'y', 0);
    if (t.inherit != null) {
      bt.inherit = arr(t.inherit).map((k) => {
        const km = obj(k);
        const v = str(km.inherit) ?? 'normal';
        return {
          time: num(km.time),
          inherit: (TRANSFORM_MODES.includes(v as TransformMode) ? v : 'normal') as TransformMode,
        };
      });
    }
    anim.bone[boneName] = bt;
  }

  /* IK 时间轴 */
  for (const [cname, keysRaw] of Object.entries(obj(a.ik))) {
    anim.ik[cname] = arr(keysRaw).map((k) => {
      const km = obj(k);
      return {
        time: num(km.time),
        mix: num(km.mix, 1), softness: num(km.softness, 0),
        bendDirection: bool(km.bendPositive, true) ? 1 as const : -1 as const,
        compress: bool(km.compress, false), stretch: bool(km.stretch, false),
        curves: curveFromJson(km, 2),
      };
    });
  }

  /* 变换约束时间轴 */
  for (const [cname, keysRaw] of Object.entries(obj(a.transform))) {
    anim.transform[cname] = arr(keysRaw).map((k) => {
      const km = obj(k);
      return {
        time: num(km.time),
        mixRotate: num(km.mixRotate, num(km.rotateMix, 1)),
        mixX: num(km.mixX, num(km.translateMix, 1)),
        mixY: num(km.mixY, num(km.mixX, num(km.translateMix, 1))),
        mixScaleX: num(km.mixScaleX, num(km.scaleMix, 1)),
        mixScaleY: num(km.mixScaleY, num(km.mixScaleX, num(km.scaleMix, 1))),
        mixShearY: num(km.mixShearY, num(km.shearMix, 1)),
        curves: curveFromJson(km, 6),
      };
    });
  }

  /* 路径约束时间轴 */
  for (const [cname, tRaw] of Object.entries(obj(a.path))) {
    const t = obj(tRaw);
    const pt: AnimationIR['path'][string] = {};
    if (t.position != null) {
      pt.position = arr(t.position).map((k) => {
        const km = obj(k);
        return { time: num(km.time), value: num(km.value, num(km.position, 0)), curves: curveFromJson(km, 1) };
      });
    }
    if (t.spacing != null) {
      pt.spacing = arr(t.spacing).map((k) => {
        const km = obj(k);
        return { time: num(km.time), value: num(km.value, num(km.spacing, 0)), curves: curveFromJson(km, 1) };
      });
    }
    if (t.mix != null) {
      pt.mix = arr(t.mix).map((k) => {
        const km = obj(k);
        return {
          time: num(km.time),
          mixRotate: num(km.mixRotate, num(km.rotateMix, 1)),
          mixX: num(km.mixX, num(km.translateMix, 1)),
          mixY: num(km.mixY, num(km.mixX, num(km.translateMix, 1))),
          curves: curveFromJson(km, 3),
        };
      });
    }
    anim.path[cname] = pt;
  }

  /* 物理时间轴（4.2） */
  for (const [cname, tRaw] of Object.entries(obj(a.physics))) {
    const t = obj(tRaw);
    const pt: AnimationIR['physics'][string] = {};
    const single = (raw: unknown) =>
      arr(raw).map((k) => {
        const km = obj(k);
        return { time: num(km.time), value: num(km.value), curves: curveFromJson(km, 1) };
      });
    for (const field of ['inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'] as const) {
      const raw = (t as J)[field];
      if (raw != null) (pt as J)[field] = single(raw);
    }
    if (t.reset != null) {
      pt.reset = arr(t.reset).map((k) => ({ time: num(obj(k).time) }));
    }
    anim.physics[cname] = pt;
  }

  /* deform / attachments 节（皮肤 > 槽位 > 附件） */
  const deformRaw = obj(a.deform ?? a.attachments);
  for (const [skinName, slotsRaw] of Object.entries(deformRaw)) {
    const slots = obj(slotsRaw);
    const skinDeform: Record<string, Record<string, DeformKey[]>> = {};
    const skinSeq: Record<string, Record<string, SequenceKey[]>> = {};
    for (const [slotName, attsRaw] of Object.entries(slots)) {
      const atts = obj(attsRaw);
      const slotDeform: Record<string, DeformKey[]> = {};
      const slotSeq: Record<string, SequenceKey[]> = {};
      for (const [attName, tlRaw] of Object.entries(atts)) {
        // 3.x/4.0：值直接为 deform 键数组；4.1+：可能为 {deform: [...], sequence: [...]}
        const tl = obj(tlRaw);
        const deformKeysRaw = Array.isArray(tlRaw) ? tlRaw : tl.deform;
        if (deformKeysRaw != null) {
          slotDeform[attName] = arr(deformKeysRaw).map((k) => {
            const km = obj(k);
            return {
              time: num(km.time),
              vertices: km.vertices != null ? nums(km.vertices) : null,
              offset: num(km.offset, 0),
              curve: readDeformCurve(km),
            };
          });
        }
        if (tl.sequence != null) {
          let lastDelay = 0;
          slotSeq[attName] = arr(tl.sequence).map((k) => {
            const km = obj(k);
            const delay = num(km.delay, lastDelay); lastDelay = delay;
            const mode = str(km.mode) ?? 'hold';
            return {
              time: num(km.time), delay,
              mode: (SEQUENCE_MODES.includes(mode as SequenceMode) ? mode : 'hold') as SequenceMode,
              index: num(km.index, 0),
            };
          });
        }
      }
      if (Object.keys(slotDeform).length) skinDeform[slotName] = slotDeform;
      if (Object.keys(slotSeq).length) skinSeq[slotName] = slotSeq;
    }
    if (Object.keys(skinDeform).length) anim.deform[skinName] = skinDeform;
    if (Object.keys(skinSeq).length) anim.sequence[skinName] = skinSeq;
  }

  /* 绘制顺序（drawOrder / draworder） */
  const drawRaw = a.drawOrder ?? a.draworder;
  if (drawRaw != null) {
    anim.drawOrder = arr(drawRaw).map((k) => {
      const km = obj(k);
      const offsets = km.offsets != null
        ? arr(km.offsets).map((o) => {
          const om = obj(o);
          return { slot: str(om.slot) ?? '', offset: num(om.offset) };
        })
        : null;
      return { time: num(km.time), offsets };
    });
  }

  /* 事件 */
  if (a.events != null) {
    const eventDef = new Map(ir.events.map((e) => [e.name, e]));
    anim.events = arr(a.events).map((k) => {
      const km = obj(k);
      const name = str(km.name) ?? '';
      const def = eventDef.get(name);
      /* 仅在源数据显式携带时才设 volume/balance（与二进制侧行为对齐，避免注入默认值） */
      const out: import('./types').EventKey = {
        time: num(km.time), name,
        int: km.int != null ? num(km.int) : def?.int,
        float: km.float != null ? num(km.float) : def?.float,
        string: str(km.string) ?? def?.string,
      };
      if (km.volume != null) out.volume = num(km.volume);
      if (km.balance != null) out.balance = num(km.balance);
      return out;
    });
  }

  return anim;
}

function readDeformCurve(km: Record<string, unknown>): Curve {
  const raw = km.curve;
  if (raw == null) return null;
  if (raw === 'stepped') return { stepped: true };
  if (typeof raw === 'number') {
    return {
      bezier: [
        raw,
        typeof km.c2 === 'number' ? km.c2 : 0,
        typeof km.c3 === 'number' ? km.c3 : 1,
        typeof km.c4 === 'number' ? km.c4 : 1,
      ],
    };
  }
  if (Array.isArray(raw) && raw.length >= 4 && typeof raw[0] === 'number') {
    const a = raw as number[];
    return { bezier: [a[0], a[1], a[2], a[3]] };
  }
  return null;
}
