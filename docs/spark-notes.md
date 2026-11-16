# Spark 2.4.0 cheat sheet (@sparkjsdev/spark) with three 0.187.0

Sources: installed `.d.ts` (dist/types) and `dist/spark.module.js` first, then https://sparkjs.dev/docs/.
Where installed code and docs disagree, installed code wins and the conflict is noted.
`(unverified)` = not confirmed in installed code (docs-only, inference, or never run on device).
Nothing here was run on an iPhone. All source claims are from reading the code, not from profiling.

Imports: `import { SparkRenderer, SplatMesh, PackedSplats, ExtSplats, SplatEdit, SplatEditSdf, dyno, utils, constructGrid } from "@sparkjsdev/spark"`

## 1. Setup and SparkRenderer options

SparkRenderer is itself a `THREE.Mesh` (frustumCulled=false). It must be in the scene: its `onBeforeRender` drives everything.
```js
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
const spark = new SparkRenderer({ renderer, enableLod: false });   // `renderer` is the only required option
scene.add(spark);
scene.add(new SplatMesh({ packedSplats }));
// then plain renderer.render(scene, camera) every frame (autoUpdate=true)
```
- Spark requires WebGLRenderer (typed `renderer: THREE.WebGLRenderer`). Source throws "Spark requires THREE.js r179 or above" if MRT array support is missing (0.187 is fine).
- `spark.render(scene, camera)` exists. It sets `SparkRenderer.sparkOverride` and calls `renderer.render`. Not needed normally.
- `await spark.update({scene, camera})` forces a generate+sort now (for offline or on-demand loops).
- `onDirty` is called when a new sort/LOD result needs another render. It can fire several times per frame, so coalesce (docs "on-demand-rendering").
- Defaults below are from the constructor in spark.module.js. `d.ts` JSDoc omits some of them.

| option | default | note |
|---|---|---|
| renderer | required | WebGLRenderer, create with antialias:false |
| premultipliedAlpha | true | sets `material.premultipliedAlpha`; settable later via `spark.premultipliedAlpha` |
| autoUpdate | true | auto generate+sort inside onBeforeRender, once per `renderer.info.render.frame` |
| preUpdate | true (non-XR) | false = update runs in a `setTimeout(1)` AFTER the render (lags one more frame) |
| maxStdDev | sqrt(8)=2.83 | kernel cut-off in sigmas. Docs: sqrt(4)..sqrt(9) OK; sqrt(5) for VR. Lower = smaller quads = cheaper |
| minPixelRadius | 0 | splat is DROPPED (not enlarged) if both projected radii are below it |
| maxPixelRadius | 512 | clamp on projected radius |
| minAlpha | 0.5/255 | alpha cull in vertex and fragment shaders |
| preBlurAmount | 0 | added to 2D covariance diagonal (blur+enlarge, no opacity compensation) |
| blurAmount | 0.3 | added to covariance diagonal WITH opacity compensation (about 0.5 px radius). Set 0 for crisp tiny splats (unverified visually) |
| falloff | 1 | 0 = flat disc (no gaussian falloff), 1 = normal gaussian. Flat discs suit pixel art |
| focalAdjustment | 1 | scales projected size (2.0 matches PlayCanvas) |
| clipXY | 1.4 | centres beyond 1.4x the frustum in x/y are culled; large near-camera splats can pop at edges |
| focalDistance / apertureAngle | 0 / 0 | depth-of-field; off when 0 |
| sortRadial | true | true = sort by distance to camera; false = by view-direction depth (+100 bias) |
| minSortIntervalMs | 0 | min gap between sorts |
| enable2DGS | false | scale component exactly 0 (below e^-30) means oriented 2D disc |
| accumExtSplats | false | float32 centres in the internal accumulator (32 B/splat). See precision section |
| covSplats | false | experimental covariance splats (needs ExtSplats on the mesh) |
| enableLod | true | no effect unless a mesh has `lodSplats`/`paged`. Set false to skip LOD work |
| enableDriveLod | = enableLod | false = don't run LOD updates |
| enableLodFetching | true | |
| lodSplatCount | undefined | target splats per frame. Platform default: iOS 1.5M, Android 1M, Quest 0.5M, VisionPro 0.75M, desktop 2.5M |
| lodSplatScale / lodRenderScale | 1 / 1 | multiplier on budget / min pixel size of LOD splats |
| lodInflate | false | |
| lodTraverseMode | "standard" | or "dynamic" |
| pagedExtSplats | false | |
| maxPagedSplats | iOS 6,291,456; other mobile 8,388,608; desktop 16,777,216 | multiple of 65536 |
| numLodFetchers | 3 | |
| lodCleanupTimeoutMs | 3000 | |
| coneFov0 / coneFov / coneFoveate / behindFoveate | 90 / 120 / 0.4 / 0.2 | foveation (LOD only) |
| lodRaycast / lodRaycastIntervalMs | 10000 mobile, 25000 desktop / 500 | |
| target | undefined | `{width,height,doubleBuffer?,superXY?} & THREE.RenderTargetOptions`, offline target (section 4) |
| transparent / depthTest / depthWrite | true / true / false | splat material flags |
| vertexShader / fragmentShader / extraUniforms | built-in | custom splat shaders |
| timer | new THREE.Timer | see Gotchas (timer) |

Not options in 2.4.0: pixel ratio (render size comes from the bound target/viewport), "sort32" (the sort is always `sortSplats32` in a worker), `stochastic`, `sortDistance`.
Public tuning fields (not constructor options): `flushAfterGenerate`, `flushAfterRead`, `readPause=1`, `sortPause=0`, `sortDelay=0`, `lodPosOverride`.

## 2. Procedural splats

```js
const packed = new PackedSplats({ maxSplats: 60000 });   // preallocates 16 B/splat on first push, rounds up to a multiple of 2048
const c = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color();
packed.pushSplat(c.set(x, y, z), s.set(0.1, 0.1, 0.1), q.identity(), 1.0 /*opacity 0..1*/, col.setRGB(r, g, b));
const mesh = new SplatMesh({ packedSplats: packed });    // synchronous when packed has no async construct
scene.add(mesh);
```
- `pushSplat(center: Vector3, scales: Vector3, quaternion: Quaternion, opacity: number, color: Color)`.
- `setSplat(index, center, scales, quaternion, opacity, color)` grows `numSplats` to `max(numSplats, index+1)`. `getSplat(index)` throws if `index >= numSplats`.
- `ensureSplats(n)` returns the (possibly reallocated) `Uint32Array`. Re-read `packed.packedArray` after pushes and never cache it. Growth is doubling.
- Fields: `maxSplats`, `numSplats`, `packedArray` (4 x uint32 per splat), `needsUpdate` (re-upload flag, see section 3), `splatEncoding`, `extra`.
- Alternatives: `new PackedSplats({ construct: (s) => { s.pushSplat(...) } })` (async init), or `new SplatMesh({ constructSplats: (packed) => {...}, maxSplats })` (mesh.initialized resolves after).
- `SplatMesh.pushSplat(...)` forwards to its packedSplats.
- Other options: `packedArray` + `numSplats` to hand over a prebuilt `Uint32Array`. Then use `utils.setPackedSplat(arr, i, x,y,z, sx,sy,sz, qx,qy,qz,qw, opacity, r,g,b)` to write directly (no Vector3 allocation).
- Other `utils` writers (all in `utils` namespace): `setPackedSplatCenter`, `setPackedSplatScales`, `setPackedSplatQuat`, `setPackedSplatRgba(arr,i,r,g,b,a)`, `setPackedSplatRgb`, `setPackedSplatOpacity`.
- Helpers (all take `splats: PackedSplats`, use inside `constructSplats`):
  - `constructGrid({splats, extents: Box3, stepSize=1, pointRadius=0.01, pointShadowScale=2, opacity, color})`
  - `constructAxes({splats, scale=0.25, axisRadius=0.0075, axisShadowScale=2, origins})`
  - `constructSpherePoints({splats, origin, radius=1, maxDepth=3, filter, pointRadius=0.02, pointThickness=0.001, color})`
  - `textSplats({text, font="Arial", fontSize=32, color, rgb, dotRadius=0.8, textAlign, lineHeight=1, objectScale})` returns a SplatMesh.
  - `imageSplats({url, dotRadius=0.8, subXY=1, forEachSplat})` returns a SplatMesh. `forEachSplat` returns null to skip, or an opacity.
  - `generators.snowBox(...)`, `generators.staticBox(...)`: stateless dyno particle generators (not needed here).
- Defaults quoted above come from docs. Types only list the signatures.

### Encoding limits (PackedSplats, from `setPackedSplat` in source)
Layout: 16 B/splat = RGBA u8 x4; centre float16 x3; quaternion octahedral (u8,u8) plus angle u8 (24 bits total); log-scale u8 x3.
- Centre is float16 (`toHalf`), NOT fixed-point. Spacing is 2^(e-10) inside [2^e, 2^(e+1)):

| \|x\| | spacing |
|---|---|
| 1..2 | 0.001 |
| 8..16 | 0.0078 |
| 16..32 | 0.0156 |
| 32..64 | 0.031 |
| 64..128 | 0.0625 |
| 128..256 | 0.125 |
| 256..512 | 0.25 |

  Max about 65504. Docs say "~0.1% resolution, up to 32K". Keep coordinates small, or use many meshes with local origins near their own centre.
- Scale: `ln(scale)` in [-12, 9] (LN_SCALE_MIN/MAX) quantised to u8 values 1..255 (254 steps).
  - Range: e^-12 = 6.1e-6 to e^9 = 8103.
  - Step ratio = exp(21/254) = about 8.6% (docs say about 7%).
  - Anything below e^-30 (SCALE_ZERO) encodes 0. A splat with all three scales 0 is skipped. One axis at 0 is a 2DGS disc only if `enable2DGS`.
- Colour: r,g,b each clamped to [0,1] and stored as u8 (rgbMin=0, rgbMax=1 default). 256 levels, no HDR. Opacity u8, linear 0..1.
- `setSplat`/`pushSplat` do NOT pass `this.splatEncoding` to `setPackedSplat` (always default ranges). `new SplatMesh({packedSplats})` also overwrites `packed.splatEncoding` with defaults plus `options.splatEncoding`. Don't customise `splatEncoding` for procedural splats.
- THE RENDERED DATA IS RE-QUANTISED AGAIN. All meshes are baked into a `SplatAccumulator`. With default `accumExtSplats:false` that bake is a packed 16 B format: centres stored float16 RELATIVE TO THE CAMERA POSITION at bake time (`center - viewCenter`), opacity halved into u8, colour u8, scale/quat as above. So float16 precision in the final image depends on distance from the camera, and is re-quantised whenever the camera moves.
  - Using ExtSplats as the source does not fix this unless the SparkRenderer also gets `accumExtSplats: true` (float32 centres, +MRT target, 2x accumulator memory).
  - Practical: at 100 units from camera, spacing is 0.0625. At 200x430 px that is far below a pixel for typical FOV. Sub-pixel shimmer when the camera moves is plausible (unverified).

### ExtSplats (exists in 2.4, docs call it "preview")
- 32 B/splat. Centre float32, opacity and colour float16, ln-scale float16, quaternion 10/10/12 bits.
- `new ExtSplats({ maxSplats, construct })`, `.pushSplat/.setSplat/.getSplat/.ensureSplats()` (returns `[Uint32Array,Uint32Array]`), `extArrays`, and `utils.encodeExtSplat(extArrays, i, ...)` per docs (unverified in `utils.d.ts`).
- Use via `new SplatMesh({ extSplats: ExtSplats | true })`. It has no `needsUpdate` flag (the mesh `updateTextures` is private). For per-frame edits prefer PackedSplats (unverified for ExtSplats).

## 3. Updating splats at runtime

Two separate flags are needed for CPU edits:
1. `packed.needsUpdate = true` re-uploads the WHOLE `DataArrayTexture` (width 2048 x height x layers, 16 B/splat, so 50k splats is about 0.8 MB) on the next generate (`maybeUpdateSource`). It is reset only when the texture is next fetched.
2. `mesh.updateVersion()` (equivalently `mesh.needsUpdate = true`, a setter on SplatGenerator) tells Spark to re-run the generate pass. Without it, nothing regenerates when only the camera is still, and the edit may not show.
```js
// cheap colour change, no re-encode of position/scale
utils.setPackedSplatRgba(packed.packedArray, i, r, g, b, 1);   // r,g,b in 0..1, same colour space as pushSplat
packed.needsUpdate = true;      // once per frame after all edits
mesh.updateVersion();
```
- Cost model (from source): any version change triggers `generate()` for ALL visible meshes (one fullscreen-quad GPU pass per mesh, over every splat), then a depth readback (4 B/splat, async) and a worker sort. It does not regenerate only the changed splats.
- The camera moving already does the same regeneration every frame (`viewChanged` = moved more than 0.001 or turned more than about 2.5 degrees). So CPU colour edits on a moving camera add only the texture upload. Real cost on iPhone not measured (unverified).
- Don't change `numSplats` or mesh visibility per frame. A mapping change (`mappingVersion`) blocks accumulator updates until the in-flight sort finishes, so moving things stall.

### GPU alternatives
- `SplatMesh` options and fields: `objectModifier(s)` (before transform, object space), `worldModifier(s)` (after transform and recolor). Order: fetch -> splatRgba -> skinning -> objectModifiers -> transform -> `recolor`*rgba -> SplatEdits -> worldModifiers.
- The `objectModifier`/`worldModifier` setters only set the arrays. Call `mesh.updateGenerator()` after assigning post-construction (docs say the same).
- `mesh.recolor` (THREE.Color) and `mesh.opacity` (number): per-mesh tint and alpha multiplier (default white and 1). Changes are detected in `update()` and bump the version automatically.
- Dyno uniform changes do NOT bump the version. Call `mesh.updateVersion()` after changing `uniform.value`.
- `SplatEdit` + `SplatEditSdf` (`scene.add(edit); edit.add(sdf)` or `mesh.edits = [edit]`):
  - `SplatEditSdf({type: SPHERE|BOX|PLANE|ALL|ELLIPSOID|CYLINDER|CAPSULE|INFINITE_CONE, invert, opacity, color, displace, radius})`.
  - `SplatEdit({name, rgbaBlendMode: MULTIPLY|SET_RGB|ADD_RGBA, sdfSmooth, softEdge, invert, sdfs})`.
  - Moving or scaling the SDF object animates a spreading blob with no CPU upload.
  - Edits are collected via `traverseVisible` every frame. A global edit (no SplatMesh ancestor) hits every mesh with `editable` (default true).
  - Max SDF counts and per-splat cost are undocumented (cost likely scales with SDF count, unverified).
  - Good for "paint spreading from a point" (SET_RGB sphere with growing `radius`). Not for arbitrary per-splat state.

### Dyno example 1: recolor by world position + uniform (worldModifier)
```js
// import { dyno } from "@sparkjsdev/spark"
const uRadius = dyno.dynoFloat(0, "paintRadius");
const uOrigin = dyno.dynoVec3(new THREE.Vector3(), "paintOrigin");
const uColor  = dyno.dynoVec3(new THREE.Vector3(1, 0.2, 0.2), "paintColor");
const paintMod = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
  const { center, rgb } = dyno.splitGsplat(gsplat).outputs;
  const d = dyno.distance(center, uOrigin);                       // world space (worldModifier runs after transform)
  const t = dyno.sub(dyno.dynoConst("float", 1), dyno.smoothstep(dyno.sub(uRadius, dyno.dynoConst("float", 0.5)), uRadius, d));
  return { gsplat: dyno.combineGsplat({ gsplat, rgb: dyno.mix(rgb, uColor, t) }) };
});
mesh.worldModifier = paintMod; mesh.updateGenerator();           // or pass `worldModifier: paintMod` to the constructor
// per frame:
uRadius.value = r; uOrigin.value.set(x, y, z); mesh.updateVersion();
```
Types checked against dyno/uniforms.d.ts, math.d.ts, splats.d.ts. Not executed.
`dynoFloat(value, key)` and `dynoVec3(value, key)` take value first.

### Dyno example 2: read a data texture (per-splat paint mask by splat index)
```js
const W = 256, H = 256;                                      // W*H >= numSplats; splat i lives at texel (i % W, i / W)
const data = new Uint8Array(W * H * 4);                     // rgb = paint colour, a = paint amount (0..255)
const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
const uTex = dyno.dynoSampler2D(tex, "paintTex");
const paintMod2 = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
  const out = new dyno.Dyno({
    inTypes: { gsplat: dyno.Gsplat, tex: "sampler2D" },
    outTypes: { gsplat: dyno.Gsplat },
    inputs: { gsplat, tex: uTex },
    globals: () => [dyno.defineGsplat],
    statements: ({ inputs, outputs }) => dyno.unindentLines(`
      ${outputs.gsplat} = ${inputs.gsplat};
      if (isGsplatActive(${inputs.gsplat}.flags)) {
        ivec2 uv = ivec2(${inputs.gsplat}.index % ${W}, ${inputs.gsplat}.index / ${W});
        vec4 p = texelFetch(${inputs.tex}, uv, 0);
        ${outputs.gsplat}.rgba.rgb = mix(${inputs.gsplat}.rgba.rgb, p.rgb, p.a);
      }
    `),
  });
  return { gsplat: out.outputs.gsplat };
});
mesh.objectModifier = paintMod2; mesh.updateGenerator();    // objectModifier: index is the original source index here
// per frame: edit `data`, then tex.needsUpdate = true; mesh.updateVersion();
```
- Cost: uploads W*H*4 B instead of 16 B/splat of packed data. It stays on GPU, and the packed splat array is never touched. Total work per frame is the same regenerate+sort.
- `gsplat.index` is the index into the source `PackedSplats` (set by `fetchSplat`). Valid in objectModifiers (unverified after the transform).
- If a mesh uses LOD, `index` is remapped. Procedural meshes don't.
- Uses a hand-written GLSL fragment (pattern copied from Spark's own `GsplatToCovSplat` in source). Never compiled here.

## 4. Rendering into a low-res WebGLRenderTarget

Works. `onBeforeRender` reads `renderer.getRenderTarget()`:
- Render size = `camera.viewport` or `renderer.getCurrentViewport()`; if the viewport is under 2 px, falls back to the target's width/height. With a bound WebGLRenderTarget, three sets the viewport to `rt.viewport` (rt pixels, no pixel ratio). So `setPixelRatio` does not affect the rt pass.
- Spark's generate and readback passes save and restore target, autoClear and xr state, so it is safe inside `renderer.render`.
- Spark 2.x does NOT render to an internal target by default. Splats are one instanced draw (quad per splat) into whatever is bound. An internal target exists only if you pass the `target` option.
```js
const rt = new THREE.WebGLRenderTarget(200, 430, {
  format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
  colorSpace: THREE.SRGBColorSpace,        // see colour paragraph
  minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
  depthBuffer: true, stencilBuffer: false,  // depth only matters if normal opaque meshes share the scene
});
renderer.setRenderTarget(rt);
renderer.setClearColor(0x000000, 1);       // opaque clear keeps alpha at 1 after premultiplied blending
renderer.render(scene, camera);            // Spark mesh is inside `scene`
renderer.setRenderTarget(null);
postQuad.render(renderer);                 // final pass
```
- Built-in alternative: `new SparkRenderer({ renderer, target: { width: 200, height: 430, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter } })` then `const rt = spark.renderTarget({scene, camera})` (it renders to `spark.target`). That target defaults to `colorSpace: SRGBColorSpace`, RGBA8. `superXY` 1..4 is supersampled and averaged only on `readTarget()` (CPU).
  With `doubleBuffer:true` the targets swap each call. Optional; plain `setRenderTarget` is simpler.
- Colour management (read from source): the splat fragment shader applies `srgbToLinear(rgb)` when `encodeLinear` is true.
  - `encodeLinear = (outputColorSpace !== SRGBColorSpace)`.
  - When rendering to the canvas it uses `renderer.outputColorSpace` (default SRGB, so raw values are written untouched).
  - When a non-XR render target is bound it uses `ColorManagement.workingColorSpace` (linear-srgb), so encodeLinear is TRUE and the shader writes LINEAR values into the rt.
  - With `rt.texture.colorSpace = SRGBColorSpace`, three allocates SRGB8_ALPHA8: hardware re-encodes on write, and `texture()` in your post shader returns LINEAR values. Output of the post pass must be converted linear->sRGB yourself.
  - With the default rt colour space (NoColorSpace, RGBA8), linear values are stored raw in 8 bits (dark shadows band badly). Prefer SRGB8_ALPHA8.
  - Alpha blending on an sRGB framebuffer happens in linear space (unverified, WebGL2 behaviour), so edges differ slightly from canvas rendering.
- `premultipliedAlpha:true` (default): fragment writes `(rgb*a, a)` with premultiplied blending. If you clear with alpha 0, the rt holds premultiplied colour; composite over a background in the post pass as `rgb + bg*(1-a)`. Opaque clear avoids this.
- Depth: material `depthTest:true`, `depthWrite:false`, `transparent:true`. Splats are drawn in the transparent pass, after opaque three meshes. Opaque meshes occlude splats behind them (needs `depthBuffer:true` on the rt). Splats never occlude meshes or each other (no depth write).
  Other transparent three objects sort against the Spark mesh by renderOrder/distance, with the Spark mesh at the origin (unverified).
- `renderer.info.render.frame` gates once-per-frame updates. Render the splat scene once per frame. Don't put the SparkRenderer in the post-pass scene.

## 5. Sorting

Where: every `SparkRenderer` frame (when the camera moved or any generator version changed) regenerates an accumulator on the GPU (`SplatAccumulator`: RGBA32UI array texture plus an RGBA8 array holding a float32 sort key). `driveSort` then does an async `readRenderTargetPixelsAsync` of that 4 B/splat key, runs the wasm `sort32_splats` in a `SplatWorker` (web worker), and uploads an `RGBA32UI` ordering texture (4096 wide). Draw = `instanceCount = activeSplats`, index fetched from the ordering texture.
- Key = distance to the view origin (`sortRadial:true`) or `dot(center - origin, viewDir) + 100` (`sortRadial:false`). Inactive splats get infinity and are excluded from `activeSplats`.
- The sort runs back-to-back (re-queues itself while `sortDirty`), throttled only by `minSortIntervalMs` (default 0).
- Latency: order lags the render by at least one frame (docs). When the mapping is unchanged, splat positions are fresh each frame and only the ORDER is stale. Fast cameras produce order popping on overlapping translucent splats.
- Mitigations:
  - `sortRadial:false` with a translation-only camera (no rotation): z-depth along a fixed view direction doesn't change under lateral translation, so order is stable (derived from the metric above, unverified in practice).
  - Mostly-opaque splats (opacity 1, falloff 0 or small `maxStdDev`) make order errors much less visible.
  - Avoid mapping changes (see section 3).
- Opaque/stochastic/depth-write modes: no `stochastic` option or code exists in 2.4.0 (grep of dist found no match). `depthWrite:true` is only a constructor flag (docs and JSDoc warn it gives artefacts because splats are mostly transparent).
  With depthWrite on you could skip sorting only for fully opaque hard-edged splats (`falloff:0`) (unverified, not tested).

## 6. LOD

2.x has an LOD tree system (`lod`, `lodAbove`, `nonLod`, `enableLod`, `lodScale` on SplatMesh; `lodSplatCount/Scale/RenderScale`, foveation `coneFov0/coneFov/coneFoveate/behindFoveate` on SparkRenderer; `SplatPager`/`PagedSplats` for streamed `.rad` files).
- `PagedSplats`/`paged:true`: streamed chunk files only (needs a URL/RAD root). Not applicable to procedural splats.
- In-memory: `await mesh.createLodSplats()` or `packed.createLodSplats()` builds a merged "tiny-lod" copy via a worker. That sets `nonLod=true` and sets `lod`. The LOD tree is a separate copy (edits to the source after that probably don't propagate, unverified).
- Per-frame budget uses `lodSplatCount` (iOS default 1.5M). With about 10^4..10^5 splats, LOD buys nothing. Pass `enableLod:false` to avoid spawning the LOD worker/driver.

## 7. Performance and stats

Docs (performance page): iPhone 1-3M splats, Android 1-2M, Quest 3 under 1M. Dense clusters (500K in a small screen area) bottleneck GPU blending even under the budget.
Docs levers: `antialias:false` (default), lower `maxStdDev` (sqrt(5)), lower pixel ratio. The per-splat accumulator pass becomes a bottleneck at about 1M splats on some systems.
For this project (tens of thousands of splats, 86k-pixel target) fill rate and overdraw are tiny. Expected costs: per-frame regenerate+readback+sort, and any shader compile hitch.
- Reduce cost: `maxStdDev` down, `falloff` toward 0, `enableLod:false`, fewer SplatMeshes (each distinct generator is its own dyno program and its own pass: new program = shader compile, likely hitchy on first use, unverified), `minPixelRadius` to drop sub-pixel splats, `minSortIntervalMs` (e.g. 33) trades popping for CPU.
- Stats: no stats/profiler API exists in 2.4.0.
  - `spark.activeSplats` (instances drawn), `spark.display.numSplats`, `spark.maxSplats`, `spark.sorting`, `spark.lastSortTime` (timestamp when the last sort STARTED, not a duration).
  - `renderer.info.render.calls/triangles` for draw stats.
  - To time sorts, wrap `onDirty` with `performance.now()` deltas (unverified).
  - In ordinary use, `spark.display.mapping` lists per-mesh `{node, base, count}`.

## 8. Lifecycle, transforms, multiple meshes
- Remove: `scene.remove(mesh); mesh.dispose();`. `SplatMesh.dispose()` also disposes its `packedSplats`/`extSplats` (even if shared with another mesh). Don't dispose a shared PackedSplats you still use.
- Replace content: either mutate `packed` in place (`needsUpdate` + `updateVersion`; changing `numSplats` triggers a mapping update), or create a new mesh, add it, then remove and dispose the old one.
- `packed.dispose()` frees its render target, texture and `packedArray`.
- `spark.dispose()` frees accumulators, workers, ordering texture. Call `scene.remove(spark)` first.
- Transforms: set `mesh.position/quaternion/scale` normally. `scale` must be uniform (docs: x/y/z averaged). The mesh matrix is applied in the GPU generate pass (`SplatTransformer`). A moved mesh bumps its version, so every visible mesh is regenerated and re-sorted that frame (same cost as camera motion; no per-splat CPU work). It is cheap only in the sense that cost doesn't scale with how many objects move.
- Multiple meshes: ALL visible SplatMeshes (`scene.traverseVisible`, filtered by camera layers) are merged into ONE accumulator, ONE global sort, ONE instanced draw. Splats from different meshes sort against each other correctly (docs system-design, confirmed in `prepareGenerate`).
- Toggling `mesh.visible` or changing `numSplats` changes the mapping (see section 3). Prefer `mesh.opacity` or keeping them visible.
- Each mesh's `generate` pass covers its whole splat array even if only one splat changed. Splitting static city and moving character into separate meshes does not reduce regenerate cost, but it keeps the packed upload for CPU edits small (only the edited mesh's texture re-uploads).
- Layers: Spark only considers generators where `camera.layers.test(node.layers)`.
- Raycasting works on PackedSplats via `mesh.raycast`. Set `raycastable:false` if unused.

## 9. three 0.187 specifics
- Spark 2.4.0 peer dep `three >= 0.180`. It uses `THREE.Timer` (core, present in 0.187) and WebGL2 MRT/array render targets. Keep `WebGLRenderer` from `"three"`. Spark's types and shaders (GLSL3, `WebGLArrayRenderTarget`, `readRenderTargetPixelsAsync`) are WebGL-only. Do NOT use `WebGPURenderer` / `three/webgpu` (unsupported by types). Don't import both `three` and `three/webgpu` (duplicate instances).
- Colour management defaults: `ColorManagement.enabled`, `renderer.outputColorSpace = SRGBColorSpace`, `WebGLRenderTarget.texture.colorSpace = NoColorSpace` by default. Non-XR render targets are assumed linear by three.
  - `new THREE.Color(0xff8800)` and `color.set(hex)` convert sRGB -> linear working space (`setHex(hex, colorSpace = SRGBColorSpace)`). Spark stores whatever numbers you give it as u8.
  - To store the colour you see, either use `col.setRGB(r,g,b)` with raw sRGB numbers (default working-space arg, no conversion), or call `col.getRGB(out, THREE.SRGBColorSpace)`.
- Fullscreen post pass (WebGL): use `FullScreenQuad` from `three/addons/postprocessing/Pass.js` (a single oversized triangle, positions already in clip space; `.render(renderer)`).
```js
const post = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
  uniforms: { tScene: { value: rt.texture } /* + palette uniforms */ },
  vertexShader: `in vec3 position; out vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.,1.); }`,
  fragmentShader: `precision highp float; uniform sampler2D tScene; in vec2 vUv; out vec4 o;
    vec3 lin2srgb(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1./2.4))-0.055, step(vec3(0.0031308), c)); }
    void main(){ vec3 lin = texture(tScene, vUv).rgb; vec3 s = lin2srgb(lin); /* quantise s to palette here */ o = vec4(s,1.); }`,
});
const postQuad = new FullScreenQuad(post);
// rt.texture min/magFilter = NearestFilter gives the blocky upscale.
```
  - RawShaderMaterial gets NO automatic output encoding, so the canvas receives exactly what you write (sRGB bytes). A non-raw `ShaderMaterial` would only encode if its shader includes `<colorspace_fragment>`.
  - The canvas is sized in CSS px times `renderer.setPixelRatio()`. The rt is independent. For crisp integer scaling, use `renderer.setPixelRatio(1)` or compute the viewport yourself.
  - Keep the post camera/scene unrelated to Spark. Rendering the splat scene happens in the rt pass only.

## Gotchas
1. Camera motion regenerates and re-sorts everything every frame. Centres in the accumulator are float16 camera-relative. Set `accumExtSplats:true` if you see shimmer at distance.
2. Edits to `packedArray` need BOTH `packed.needsUpdate = true` and `mesh.updateVersion()`. Dyno uniform and texture changes need `mesh.updateVersion()` (and `texture.needsUpdate = true`).
3. `new THREE.Color(0xRRGGBB)` is linearised. Use `setRGB` with raw values, or splat colours will look too dark.
4. Rendering into a render target writes LINEAR output (encodeLinear is true for non-XR targets). Use `colorSpace: SRGBColorSpace` on the rt and linear->sRGB in the post pass, or banding and wrong palette matches follow.
5. `timer` quirk: `ownsTimer = !!options.timer`, so the default internal timer is never `update()`d by Spark (the unconditional-looking `if (this.ownsTimer) this.timer.update()` runs only when YOU pass a timer, and Spark then updates it). Dyno `context.time`/`deltaTime`/`SplatMesh.dynoTime` stay at 0 with the default. Drive animation with your own uniforms or pass a `THREE.Timer` and don't also update it. (From source reading, never run.)
6. `SplatMesh({packedSplats})` resets `packed.splatEncoding` to defaults, and `pushSplat/setSplat` ignore it anyway. Don't customise `splatEncoding`.
7. `SplatMesh.dispose()` disposes the shared `PackedSplats`. `ensureSplats` can reallocate `packedArray` (don't hold stale references).
8. Don't change mesh `numSplats` or `visible` every frame: mapping changes stall the display while a sort is in flight.
9. Set `enableLod:false` for procedural-only scenes (skips the LOD driver and its worker). `SplatPager`/`paged` are for streamed `.rad` files only.
10. `blurAmount` default 0.3 enlarges every splat by about 0.5 px radius. At 200 px wide this is visible. Tune `blurAmount`, `minPixelRadius`, `falloff` for the pixel-art look. Verify by eye, since effects at this resolution are untested.
11. No `stochastic`/opaque mode exists in 2.4.0, and there is no stats API. Sorting is always the wasm 32-bit sort in a worker.
12. A `SparkRenderer` must be added to the scene being rendered. `antialias:false` on the WebGLRenderer (default) matters for iOS fill rate. The iPhone Safari behaviour of `readRenderTargetPixelsAsync` and RGBA32UI MRT targets is unverified (Spark's own default path uses them).

## Docs vs installed disagreements
- docs/system-design: mentions `SparkViewpoint` and a "bucket sort". Installed 2.4.0 has no `SparkViewpoint` symbol at all. Sorting is `SparkRenderer.driveSort` + wasm `sort32_splats`.
- docs/packed-splats: scale "approximately 7% steps". Encoding constants give 254 steps over ln range 21, about 8.6%.
- docs/packed-splats and procedural-splats do not mention `needsUpdate`/`updateVersion`; the types and source show both are required for CPU edits.
- `d.ts` JSDoc for `blurAmount` and `minPixelRadius` gives no default. Source defaults are 0.3 and 0. JSDoc says `lodRaycast` default applies "iff default canvas target is used", while source sets it regardless.
- `d.ts` `timer` JSDoc suggests passing a Timer is only for synchronisation. Source makes Spark call `update()` on a Timer you pass, and never on the default one.
