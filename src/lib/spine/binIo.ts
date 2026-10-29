/**
 * 二进制底层读写原语 —— 与 libgdx DataInput/DataOutput 语义严格一致。
 * - float / int32：大端
 * - varint：7bit/字节，最高位为继续位；zigzag 变体用于有符号数
 * - string：varint 长度前缀（0=null，1=空串），UTF-8 内容
 */
export class BinReader {
  private view: DataView;
  private bytes: Uint8Array;
  pos = 0;
  strings: (string | null)[] = [];
  /** 调试钩子：每次原语读取后回调（起始位置 + 内容标记） */
  trace: ((pos: number, what: string) => void) | null = null;

  constructor(public buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
  }

  get remaining(): number { return this.buffer.byteLength - this.pos; }

  byte(): number {
    if (this.pos >= this.bytes.length) throw new Error('二进制数据意外结束（读取超出文件长度）');
    const v = this.bytes[this.pos++];
    if (this.trace) this.trace(this.pos - 1, `byte=${v}`);
    return v;
  }
  boolean(): boolean { return this.byte() !== 0; }
  sbyte(): number { const b = this.byte(); return b > 127 ? b - 256 : b; }
  int32(): number {
    const v = this.view.getInt32(this.pos, false);
    this.pos += 4;
    if (this.trace) this.trace(this.pos - 4, `int32=${v}`);
    return v;
  }
  float(): number {
    const v = this.view.getFloat32(this.pos, false);
    this.pos += 4;
    if (this.trace) this.trace(this.pos - 4, `float=${v}`);
    return v;
  }
  int64(): number {
    const v = this.view.getBigInt64(this.pos, false);
    this.pos += 8;
    return Number(v);
  }
  ushort(): number {
    const v = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return v;
  }
  short(): number {
    const v = this.view.getInt16(this.pos, false);
    this.pos += 2;
    return v;
  }

  /** 无符号 varint */
  varint(): number {
    const start = this.pos;
    let b = this.byte();
    let value = b & 0x7f;
    let shift = 7;
    while (b & 0x80) {
      b = this.byte();
      value += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (shift > 35) throw new Error('varint 过长');
    }
    if (this.trace) this.trace(start, `varint=${value}`);
    return value;
  }
  /** zigzag varint */
  varintZ(): number {
    const v = this.varint();
    return Math.floor(v / 2) ^ -(v % 2);
  }

  string(): string | null {
    let byteCount = this.varint();
    if (byteCount === 0) { if (this.trace) this.trace(this.pos, 'string=null'); return null; }
    if (byteCount === 1) { byteCount = 0; if (this.trace) this.trace(this.pos, "string=''"); return ''; }
    byteCount -= 1;
    if (this.pos + byteCount > this.bytes.length) throw new Error('字符串读取超出文件长度');
    const slice = this.bytes.subarray(this.pos, this.pos + byteCount);
    const s = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    this.pos += byteCount;
    if (this.trace) this.trace(this.pos - byteCount, `string=${JSON.stringify(s)}`);
    return s;
  }

  stringRef(): string | null {
    const index = this.varint();
    if (index === 0) return null;
    const s = this.strings[index - 1];
    if (s == null) throw new Error(`字符串表引用越界：index=${index}`);
    return s;
  }

  floatArray(n: number): number[] {
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = this.float();
    return out;
  }
  /** 3.x / 4.0 / 4.1：计数 varint + 2 字节大端 short */
  shortArrayRaw(): number[] {
    const n = this.varint();
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = this.short();
    return out;
  }
  /** 4.2：varint 编码的 short 值 */
  shortArrayVarint(n: number): number[] {
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = this.varint();
    return out;
  }
}

export class BinWriter {
  private chunks: number[] = [];
  private enc = new TextEncoder();
  strings: string[] = [];        // 字符串表（3.8+ / 4.x）
  private strIndex = new Map<string, number>();

  get byteLength(): number { return this.chunks.length; }

  writeByte(b: number): void { this.chunks.push(b & 0xff); }
  writeBoolean(b: boolean): void { this.chunks.push(b ? 1 : 0); }
  writeInt32(v: number): void {
    this.chunks.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  writeFloat(v: number): void {
    const buf = new DataView(new ArrayBuffer(4));
    buf.setFloat32(0, v, false);
    for (let i = 0; i < 4; i++) this.chunks.push(buf.getUint8(i));
  }
  writeInt64(v: number): void {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setBigInt64(0, BigInt(Math.trunc(v)), false);
    for (let i = 0; i < 8; i++) this.chunks.push(buf.getUint8(i));
  }
  writeShort(v: number): void {
    this.chunks.push((v >> 8) & 0xff, v & 0xff);
  }

  writeVarint(value: number): void {
    let v = value;
    if (v < 0) v = v + 2 ** 32; // 按无符号 32 位处理
    while (v >= 0x80) {
      this.chunks.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.chunks.push(v);
  }
  writeVarintZ(value: number): void {
    this.writeVarint(value >= 0 ? value * 2 : -value * 2 - 1);
  }

  writeString(s: string | null): void {
    if (s == null) { this.chunks.push(0); return; }
    if (s === '') { this.chunks.push(1); return; }
    const bytes = this.enc.encode(s);
    this.writeVarint(bytes.length + 1);
    for (const b of bytes) this.chunks.push(b);
  }

  /** 写字符串表引用（1-based）。null → 0。字符串需先注册进表。 */
  writeStringRef(s: string | null): void {
    if (s == null) { this.chunks.push(0); return; }
    const idx = this.strIndex.get(s);
    if (idx == null) throw new Error(`字符串未注册进字符串表：${s}`);
    this.writeVarint(idx + 1);
  }

  /** 注册字符串（去重），返回是否新注册 */
  registerString(s: string): boolean {
    if (this.strIndex.has(s)) return false;
    this.strIndex.set(s, this.strings.length);
    this.strings.push(s);
    return true;
  }

  /** 写 short 数组：raw = 计数+2字节大端；varint = varint 值（4.2 mesh triangles 无计数前缀时直接写值） */
  writeShortArrayRaw(values: number[]): void {
    this.writeVarint(values.length);
    for (const v of values) this.writeShort(v);
  }
  writeShortValuesVarint(values: number[]): void {
    for (const v of values) this.writeVarint(v);
  }
  writeFloatArray(values: number[]): void {
    for (const v of values) this.writeFloat(v);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.chunks);
  }

  /** 把字符串表插入到指定字节位置（头部之后）——供 3.8+/4.x 组装用 */
  spliceAt(pos: number, data: number[]): void {
    this.chunks.splice(pos, 0, ...data);
  }
}

/* ---------------- 4.x hash 表示（8 字节大端 ↔ base64 字符串） ---------------- */

/** 8 字节大端 → base64 字符串（无填充；与官方 JSON 导出的 hash 同构） */
export function bytesToB64(bytes: number[]): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, '');
}

/** hash 字符串 → 8 字节大端。支持 base64（官方 JSON 形式）/ 十进制 / 十六进制；无法解析返回 null */
export function hashToBytes64(hash: string | null | undefined): number[] | null {
  if (!hash) return null;
  // base64：官方 JSON 导出的 8 字节 hash 形式
  if (/^[A-Za-z0-9+/]{10,12}={0,2}$/.test(hash)) {
    try {
      const bin = atob(hash.padEnd(Math.ceil(hash.length / 4) * 4, '='));
      if (bin.length === 8) return [...bin].map((ch) => ch.charCodeAt(0));
    } catch { /* 落到其他形式 */ }
  }
  let bi: bigint | null = null;
  if (/^-?\d+$/.test(hash)) bi = BigInt(hash);
  else if (/^(0x)?[0-9a-f]{1,16}$/i.test(hash)) bi = BigInt(hash.startsWith('0x') ? hash : '0x' + hash);
  if (bi == null || bi < BigInt(0) || bi > BigInt('0xffffffffffffffff')) return null;
  const out: number[] = [];
  for (let i = 7; i >= 0; i--) out[7 - i] = Number((bi >> BigInt(8 * i)) & BigInt(0xff));
  return out;
}
