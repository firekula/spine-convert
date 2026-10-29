/**
 * Spine 骨骼数据中间表示（IR）—— 3.2 ~ 4.2 全版本特性的超集。
 * 依据官方 spine-libgdx 各版本运行时源码与真实导出文件实证（见 research/spine-format-spec.md）。
 */

export type SpineVersion =
  | '3.2' | '3.3' | '3.4' | '3.5' | '3.6' | '3.7' | '3.8'
  | '4.0' | '4.1' | '4.2';

export type TransformMode =
  | 'normal' | 'onlyTranslation' | 'noRotationOrReflection'
  | 'noScale' | 'noScaleOrReflection';

export type BlendMode = 'normal' | 'additive' | 'multiply' | 'screen';

export type PositionMode = 'fixed' | 'percent';
export type SpacingMode = 'fixed' | 'length' | 'percent' | 'proportional';
export type RotateMode = 'tangent' | 'chain' | 'chainScale';

export type SequenceMode =
  | 'hold' | 'once' | 'loop' | 'pingpong'
  | 'onceReverse' | 'loopReverse' | 'pingpongReverse';

/** 单个值的插值曲线：null/undefined = 线性 */
export type Curve = { stepped: true } | { bezier: [number, number, number, number] } | null;

/** 曲线数组按值索引（curves[i] 描述第 i 个值从当前键到下一键的插值） */
export interface KeyBase { time: number; curves?: Curve[] }

export interface RotateKey extends KeyBase { angle: number }
export interface XYKey extends KeyBase { x: number; y: number }
export interface SingleKey extends KeyBase { value: number }
export interface InheritKey { time: number; inherit: TransformMode }
export interface AttachmentTimelineKey { time: number; name: string | null }
/** 颜色：light 为 RRGGBBAA；dark 为 RRGGBB */
export interface ColorKey extends KeyBase { color: string }
export interface TwoColorKey extends KeyBase { light: string; dark: string }

export interface IkKey extends KeyBase {
  mix: number; softness: number;
  bendDirection: 1 | -1; compress: boolean; stretch: boolean;
}
export interface TransformKey extends KeyBase {
  mixRotate: number; mixX: number; mixY: number;
  mixScaleX: number; mixScaleY: number; mixShearY: number;
}
export interface PathMixKey extends KeyBase { mixRotate: number; mixX: number; mixY: number }

export interface PhysicsTimelines {
  inertia?: SingleKey[]; strength?: SingleKey[]; damping?: SingleKey[];
  mass?: SingleKey[]; wind?: SingleKey[]; gravity?: SingleKey[]; mix?: SingleKey[];
  reset?: { time: number }[];
}

export interface DeformKey {
  time: number;
  /** null/undefined = 恢复 setup 姿态 */
  vertices: number[] | null;
  /** 稀疏起始位置（默认 0） */
  offset: number;
  curve: Curve;
}

export interface SequenceKey {
  time: number; delay: number; mode: SequenceMode; index: number;
}

export interface DrawOrderKey {
  time: number;
  offsets: { slot: string; offset: number }[] | null;
}

export interface EventKey {
  time: number; name: string;
  int?: number; float?: number; string?: string;
  volume?: number; balance?: number;
}

export interface BoneIR {
  name: string; parent: string | null;
  length: number; rotation: number; x: number; y: number;
  scaleX: number; scaleY: number; shearX: number; shearY: number;
  transformMode: TransformMode;
  /** 3.4 及更早的继承方式（写出 3.4- 目标时使用） */
  inheritRotation?: boolean; inheritScale?: boolean;
  skinRequired?: boolean;
  color?: string | null;
  icon?: string | null;
  visible?: boolean;
}

export interface SlotIR {
  name: string; bone: string;
  color: string;             // RRGGBBAA
  dark?: string | null;      // RRGGBB（3.6+）
  attachment?: string | null;
  blend: BlendMode;
  visible?: boolean;         // 4.2 二进制
}

export interface IkIR {
  name: string; order: number; skinRequired: boolean;
  bones: string[]; target: string;
  mix: number; softness: number;
  bendDirection: 1 | -1; compress: boolean; stretch: boolean; uniform: boolean;
}

export interface TransformIR {
  name: string; order: number; skinRequired: boolean;
  bones: string[]; target: string;
  local: boolean; relative: boolean;
  offsetRotation: number; offsetX: number; offsetY: number;
  offsetScaleX: number; offsetScaleY: number; offsetShearY: number;
  mixRotate: number; mixX: number; mixY: number;
  mixScaleX: number; mixScaleY: number; mixShearY: number;
}

export interface PathIR {
  name: string; order: number; skinRequired: boolean;
  bones: string[]; target: string;   // target 为槽位名
  positionMode: PositionMode; spacingMode: SpacingMode; rotateMode: RotateMode;
  offsetRotation: number; position: number; spacing: number;
  mixRotate: number; mixX: number; mixY: number;
}

export interface PhysicsIR {
  name: string; order: number; skinRequired: boolean;
  bone: string;
  x: number; y: number; rotate: number; scaleX: number; shearX: number;
  limit: number; fps: number;
  inertia: number; strength: number; damping: number; mass: number;
  wind: number; gravity: number; mix: number;
  inertiaGlobal: boolean; strengthGlobal: boolean; dampingGlobal: boolean;
  massGlobal: boolean; windGlobal: boolean; gravityGlobal: boolean; mixGlobal: boolean;
}

export interface SequenceIR {
  count: number; start: number; digits: number; setup: number;
}

/** 顶点数据：运行时内部形态。weighted 时 vertices 为 [x,y,w,...] 三元组，bones 为 [n, idx, idx...] */
export interface VerticesIR {
  weighted: boolean;
  /** 非加权：[x,y,...]；加权：[x,y,weight,...] */
  vertices: number[];
  /** 仅加权：[boneCount, boneIdx, boneIdx...] */
  bones?: number[];
}

export type AttachmentIR =
  | {
      type: 'region'; name: string; path: string | null;
      rotation: number; x: number; y: number; scaleX: number; scaleY: number;
      width: number; height: number; color?: string | null;
      sequence?: SequenceIR | null;
    }
  | {
      type: 'boundingbox'; name: string;
      verts: VerticesIR; color?: string | null;
    }
  | {
      type: 'mesh'; name: string; path: string | null;
      uvs: number[]; triangles: number[]; verts: VerticesIR;
      hull: number; edges?: number[] | null;
      width: number; height: number; color?: string | null;
      sequence?: SequenceIR | null;
    }
  | {
      type: 'linkedmesh'; name: string; path: string | null;
      skin: string | null; parent: string; deform: boolean;
      width: number; height: number; color?: string | null;
      sequence?: SequenceIR | null;
    }
  | {
      type: 'path'; name: string;
      closed: boolean; constantSpeed: boolean;
      vertexCount: number; verts: VerticesIR; lengths: number[];
      color?: string | null;
    }
  | {
      type: 'point'; name: string;
      rotation: number; x: number; y: number; color?: string | null;
    }
  | {
      type: 'clipping'; name: string;
      end: string; vertexCount: number; verts: VerticesIR; color?: string | null;
    };

export interface SkinEntryIR { slot: string; name: string; attachment: AttachmentIR }

export interface SkinIR {
  name: string;
  bones: string[];
  constraints: { ik: string[]; transform: string[]; path: string[]; physics: string[] };
  entries: SkinEntryIR[];
  color?: string | null;   // 4.2 编辑器元数据
}

export interface EventDefIR {
  name: string; int: number; float: number; string: string;
  audio: string | null; volume: number; balance: number;
}

export interface BoneTimelinesIR {
  rotate?: RotateKey[];
  translate?: XYKey[]; translatex?: SingleKey[]; translatey?: SingleKey[];
  scale?: XYKey[]; scalex?: SingleKey[]; scaley?: SingleKey[];
  shear?: XYKey[]; shearx?: SingleKey[]; sheary?: SingleKey[];
  inherit?: InheritKey[];
}

export interface SlotTimelinesIR {
  attachment?: AttachmentTimelineKey[];
  color?: ColorKey[];       // 统一为 4 值（含 alpha）
  twoColor?: TwoColorKey[];
  alpha?: SingleKey[];      // 4.x
}

export interface AnimationIR {
  name: string;
  bone: Record<string, BoneTimelinesIR>;
  slot: Record<string, SlotTimelinesIR>;
  ik: Record<string, IkKey[]>;
  transform: Record<string, TransformKey[]>;
  path: Record<string, { position?: SingleKey[]; spacing?: SingleKey[]; mix?: PathMixKey[] }>;
  /** 键：约束名或 ''（全部约束，4.2 二进制 index=0） */
  physics: Record<string, PhysicsTimelines>;
  /** 皮肤 > 槽位 > 附件名 */
  deform: Record<string, Record<string, Record<string, DeformKey[]>>>;
  sequence: Record<string, Record<string, Record<string, SequenceKey[]>>>;
  drawOrder: DrawOrderKey[];
  events: EventKey[];
}

export interface SkeletonIR {
  hash: string | null;
  version: string;
  x: number; y: number; width: number; height: number;
  fps: number;
  imagesPath: string | null;
  audioPath: string | null;
  referenceScale: number;   // 4.2
  /** 曲线坐标系：'abs' = 4.x 绝对坐标（时间/值）；'norm' = 3.x 归一化。缺省视为 'norm'。
   *  读取器按源版本原生空间保留，写出器按目标空间转换（见 color.ts convertAnimationCurves） */
  curveSpace?: 'norm' | 'abs';
  bones: BoneIR[];
  slots: SlotIR[];
  ik: IkIR[];
  transform: TransformIR[];
  path: PathIR[];
  physics: PhysicsIR[];
  defaultSkin: SkinIR | null;
  skins: SkinIR[];
  events: EventDefIR[];
  animations: AnimationIR[];
}

/* ---------------- 转换报告 ---------------- */

export type ReportLevel = 'convert' | 'degrade' | 'drop' | 'warn' | 'info';

export interface ReportItem {
  level: ReportLevel;
  category: string;      // 如 "物理约束"、"序列帧"、"皮肤结构"
  message: string;
  count?: number;
}

export interface ConversionReport { items: ReportItem[] }

export interface SkeletonStats {
  bones: number; slots: number; skins: number; attachments: number;
  ik: number; transform: number; path: number; physics: number;
  events: number; animations: number; timelines: number;
}

/* ---------------- 转换选项 ---------------- */

export type TargetFormat = 'json' | 'binary';

export interface ConvertOptions {
  targetVersion: SpineVersion;
  targetFormat: TargetFormat;
  /** 源文件缺版本字段时的覆盖指定 */
  sourceVersionOverride?: SpineVersion;
  /** JSON 输出美化缩进 */
  prettyJson?: boolean;
  /** 清空 hash（默认 true） */
  clearHash?: boolean;
  /** 序列帧附件降级策略：keep-static = 保留为静态附件；remove = 移除 */
  sequenceDowngrade?: 'keep-static' | 'remove';
  /** 二进制写出时包含 nonessential 元数据（默认 true，保留路径与颜色等编辑器信息） */
  nonessential?: boolean;
  /**
   * 自定义写出的版本串（如 "4.2.45"）。Spine 4.0+ 编辑器导入时要求主次版本完全一致，
   * 留空则按目标版本取该系列末期补丁号（见 VERSION_STRINGS）。
   */
  versionString?: string;
}
