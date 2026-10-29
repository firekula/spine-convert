# Spine 数据格式规范速查（3.2 ~ 4.2）

> 依据：官方 spine-libgdx 运行时源码（Maven 3.5.51.1~4.2.12 + GitHub 3.4.02）+ 官方示例导出文件实证。
> 本文档是实现 src/lib/spine/* 的规范依据。

## 版本能力矩阵（特性 → 引入版本）

| 特性 | 引入版本 | 降级策略（往低版本转） |
|---|---|---|
| 骨骼 shearX/shearY + shear 时间轴 | ≤3.2（3.4 reader 已有） | 无需降级 |
| IK 弯曲 bendPositive | ≤3.2 | 无需降级 |
| mesh/linkedmesh/boundingbox 附件 | ≤3.2 | — |
| 变换约束 transform | 3.3 | 3.2：移除 + 警告 |
| 路径约束 path + path 附件 | 3.4 | ≤3.3：移除 + 警告 |
| blend=screen | 3.5（枚举有） | ≤3.4：转 normal + 警告 |
| 骨骼 transform 模式 | 3.5（3.4 用 inheritRotation/inheritScale 布尔） | 3.4：normal→T,T；onlyTranslation→F,F；noRotationOrReflection→F,T；noScale(OrReflection)→T,F |
| 约束 order 字段 | 3.5 | ≤3.4：按 order 排序输出（等价实现） |
| 二进制 fps | 3.5 | — |
| 二进制 audioPath（nonessential） | 3.7 | — |
| 槽位 dark 颜色 + twoColor 时间轴 | 3.6（二进制 3.6 也有 darkColor/SLOT_TWO_COLOR） | ≤3.5：丢弃 dark；twoColor→color |
| point 附件 / clipping 附件 | 3.6 | ≤3.5：移除该附件 + 清空槽位引用 + 警告 |
| 变换约束 local/relative | 3.6 | ≤3.5：丢弃（false）+ 警告 |
| IK compress/stretch/uniform | 3.7 | ≤3.6：丢弃（false） |
| 事件 balance | 3.7 | ≤3.6：丢弃 |
| IK softness | 3.8 | ≤3.7：丢弃 |
| skinRequired（骨骼/约束 skin 字段） | 3.8 | ≤3.7：丢弃 |
| 皮肤级 bones/constraints 列表 | 3.8 | ≤3.7：丢弃 + 警告 |
| 骨架 x/y 偏移 | 3.8 | ≤3.7：非零时警告并丢弃 |
| skins 数组结构 | 3.8（3.2~3.7 为对象 {皮肤名: {槽位: {...}}}） | 纯格式映射 |
| linkedmesh deform(bool) | JSON 3.4 就有；二进制 3.4~3.7 无 | 二进制 ≤3.7 目标：deform=false 时警告 |
| 单轴时间轴 translatex/y, scalex/y, shearx/y | 4.0 | ≤3.8：合并进 translate/scale/shear（采样合并） |
| 槽位时间轴改名 color→rgba、twoColor→rgba2；新增 rgb/rgb2/alpha | 4.0 | ≤3.8：rgba→color、rgba2→twoColor、rgb/alpha→合并进 color、rgb2→合并进 twoColor |
| 逐值贝塞尔曲线（4×n 元素） | 4.0（3.x 为共享 4 元素） | ≤3.8：各值曲线不一致时取第一值曲线 + 警告 |
| 变换约束字段改名 rotateMix→mixRotate 等 + mixY/mixScaleY | 4.0 | ≤3.8：mixRotate→rotateMix、mixX→translateMix、mixScaleX→scaleMix、mixShearY→shearMix；mixY/mixScaleY 不等时丢弃 + 警告 |
| 路径 mix mixRotate/mixX/mixY | 4.0 | ≤3.8：mixRotate→rotateMix、mixX→translateMix、mixY 丢弃（不等时警告） |
| 序列帧 sequence | 4.1 | ≤4.0：按用户选项：保留为静态附件（原始 path）或移除 + 警告 |
| deform 节改名 attachments（层级同为 皮肤>槽位>附件） | 4.1 | 纯格式映射 |
| 物理约束 + 物理时间轴 | 4.2 | ≤4.1：移除 + 警告 |
| inherit 时间轴 | 4.2 | ≤4.1：移除 + 警告 |
| 骨骼 icon / visible、槽位 visible、皮肤 color、referenceScale | 4.2 | ≤4.1：丢弃（编辑器元数据，不影响运行时渲染） |

## JSON 结构差异要点

- 3.2/3.3：无 "spine" 版本字段的可能有；其余结构 ≈3.4（无 transform/path 约束节）。工具对无版本字段文件提示用户确认版本。
- skins：`3.2~3.7: {"default": {slot: {att: {...}}}}`；`3.8+: [{"name","bones"?,"ik"?,"transform"?,"path"?,"physics"?,"attachments": {slot: {att: {...}}}}]`
- 动画节：slots(attachment/color/twoColor | attachment/rgba/rgb/rgba2/rgb2/alpha)、bones(rotate/translate[/x/y]/scale[/x/y]/shear[/x/y]/inherit)、ik、transform、path(position/spacing/mix)、deform(≤4.0) 或 attachments(4.1+)（层级：皮肤>槽位>附件，键：deform / sequence）、drawOrder、events
- drawOrder JSON 各版本一致：`{"time":t,"offsets":[{"slot":名字,"offset":n}]}`
- 事件（根 events）：name → {int, float, string, audio, volume, balance(3.7+)}
- 3.4 骨骼：inheritRotation/inheritScale 布尔；3.5+：transform 字符串
- 3.8 IK：mix, softness, bendPositive, compress, stretch, uniform；4.x 同名；3.6/3.7 无 softness；3.4/3.5 无 compress/stretch/uniform
- curve：`"stepped"` 或数组。3.x 数组固定 4 元素（共享）；4.x 数组为 4×值个数（rgba 16、xy 8、单值 4）

## 二进制家族布局（读取顺序）

底层编码（所有版本相同）：
- float：4 字节大端 IEEE754；int32 颜色：4 字节大端（字节序 R,G,B,A）
- varint(positive)：7bit/字节，最高位继续；readInt(false)=zigzag varint
- string：varint 长度（0=null,1=空串），随后 UTF-8 字节（长度-1）
- 4.x hash：8 字节大端 int64（0=null）；3.x hash：string
- 颜色（附件/槽位/骨骼）：int32 rgba8888（大端）；dark 颜色：int32，低 24 位 rgb888，-1=无（编辑器实际写 0xFFFFFF 表示无）
- 4.x 动画槽位颜色：单字节 0-255（非 int32）

### 家族 A：3.2/3.3/3.4（3.2/3.3 按 3.4 布局尽力读取）
hash, version, width, height, nonessential[images], bones(name,[parent],rot,x,y,sx,sy,shx,shy,len,inheritRotation,inheritScale,[color]), slots(name,boneIdx,color,dark? 无!,attachmentName,blend), ik(name,bones,target,mix,bendDir), 无 transform/path 节, skins(名称在外读取), events, animations
- 3.4 有 path 节（3.2/3.3 目标写出时不写该节）；3.4 二进制 skins: default slotCount + 每槽位 attCount + name+attachment（无字符串表，全 inline string）

### 家族 B：3.5（=A + fps + order + transformMode 变长 + compress? 否！3.5 无 compress）
ik: name, order, bones, target, mix, bendDir（无 compress/stretch/uniform —— 它们 3.7 才有）
### 家族 B2：3.6/3.7（相同）
=3.5 + 槽位 darkColor(int32,-1=无) + transform local/relative + point/clipping + SLOT_TWO_COLOR + IK compress/stretch/uniform(3.7) + 3.7: nonessential audioPath、事件 balance
### 家族 C：3.8
hash,version,x,y,width,height,nonessential[fps,images,audio],字符串表(count+strings),bones(...,transformMode varint,skinRequired,[color]),slots(...,attachmentName=stringRef,darkColor),ik(+order,skinRequired,softness),transform(+skinRequired),path(+skinRequired),default skin(slotCount=0→null),skins(nameRef,bones,ik,transform,path,slotCount),events(nameRef),animations；动画槽位类型 0/1/2(attachment/color/twoColor, 颜色 int32)；骨骼 0/1/2/3；IK 帧(time,mix,softness,bendDir字节,compress,stretch)；deform: skinIdx→slotIdx→attRef→帧；事件串=bool+string
### 家族 D：4.0（=4.1 减 sequence）
hash(long),version,x,y,width,height,nonessential[fps,images,audio],字符串表,bones(transformMode varint,skinRequired,[color]),slots,ik(order,skinRequired,mix,softness,bendDir,compress,stretch,uniform),transform(skinRequired,local,relative,12 floats),path(skinRequired,3 varint modes,offsetRot,position,spacing,mixRotate,mixX,mixY),skins(nameRef),events(nameRef,bool+string),动画：槽位类型 0-5 字节颜色+bezierCount+逐值曲线；骨骼类型 0-9；IK 帧 time+mix+softness+byte+2bool；transform 帧 time+6 floats；path mix 3 floats；deform 节= skinIdx→slotIdx→attRef→frameCount+bezierCount（无类型字节）
### 家族 E：4.1（=D + sequence）
region/mesh/linkedmesh 尾部 readSequence（bool 前缀 + count/start/digits/setup 4 varint）；deform 节有类型字节（0=deform,1=sequence）
### 家族 F：4.2
+referenceScale(float, 默认100)；bones: inherit=readByte(非varint), [color,icon string,visible]；slots:[visible]；IK/transform/path/物理约束 flags 压缩；skins: name=readString(非ref),[color],constraints 含 physics；linkedmesh: skinIndex varint(非名称)；mesh 布局重排（hullLength 在 vertices 前，uvs 在 vertices 后长度=vertices.length，triangles 数量=(len-hull-2)*3 无前缀计数，edges 有前缀计数，short 全部 varint 编码）；附件 flags 字节（低3位类型，bit3 name ref，bit4 path/weighted，bit5 color，bit6 sequence，bit7 rotation/weighted(不同类型含义不同)）；事件 name=readString，事件串无 bool 前缀（null→默认值）；IK 时间轴 flags 字节；物理时间轴（type 0/1/2/4/5/6/7/8，注意没有 3）

## 4.2 物理约束 JSON 字段
name, order, skin, bone, x, y, rotate, scaleX, shearX, limit(默认5000), fps(默认60), inertia(1), strength(100), damping(1), mass(1), wind(0), gravity(0), mix(1), inertiaGlobal/strengthGlobal/dampingGlobal/massGlobal/windGlobal/gravityGlobal/mixGlobal(默认false)
物理时间轴键：inertia/strength/damping/mass/wind/gravity/mix（单值）+ reset（仅 time）

## sequence JSON
附件字段：sequence: {count, start(1), digits(0), setup(0)}（region/mesh/linkedmesh，4.1+）
时间轴键（attachments 节内）：{time, delay(默认上一帧), mode(默认hold, 可选 hold/once/loop/pingpong/onceReverse/loopReverse/pingpongReverse), index(默认0)}

## 二进制写出注意
- writeShortArray：3.x=计数varint+2字节原始short；4.0/4.1=计数varint+2字节short；4.2=varint short（mesh triangles 无计数前缀但数量必须等于 (2*vc-hull-2)*3；edges 有计数前缀）
- 字符串表（3.8+/4.x）：写文件时按需追加+索引引用（1-based，0=null）
- 3.8/4.x 槽位 attachmentName、皮肤内附件名/attachment key、IK 无、事件名(3.8/4.0/4.1 ref)等用 ref；其余 inline
- 4.2 附件 name：flags bit3 才写 ref；默认用 attachment key
- 首骨骼无 parent 索引字节（i==0 跳过）
- 3.x darkColor=0xFFFFFF 表示无 dark（编辑器行为）；-1 亦可
- 默认皮肤：slotCount=0 → 整个默认皮肤为 null（无后续数据）
