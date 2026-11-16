// Spark customisation: the per-splat decode modifier (origin, radius, paint) and the splat
// shader patches (hard opaque discs or pixel-snapped squares, raw palette-index output,
// on-screen size floor).

import * as THREE from "three";
import { dyno, type SparkRenderer } from "@sparkjsdev/spark";
import { PAINT_W, PAINT_H, PAINT_SPAN } from "../sim/paint";

/** Spark packs ln(scale) in [-12, 9] into bytes 1..255. These helpers store a raw byte in a scale field. */
const LN_MIN = -12, LN_MAX = 9;
export function byteToScale(b: number): number { return Math.exp(LN_MIN + ((b - 1) * (LN_MAX - LN_MIN)) / 254); }
/** World origin grid used for splat centres (float16 centres are stored relative to it). */
export const ORIGIN_STEP = 8;
export const ORIGIN_BIAS = 16;
export function originByteX(ox: number): number { return ox / ORIGIN_STEP + ORIGIN_BIAS; }
export function originByteZ(oz: number): number { return -oz / ORIGIN_STEP + ORIGIN_BIAS; }

/** Splats store a Gaussian sigma; Spark draws the disc out to maxStdDev sigmas. */
export const MAX_STD_DEV = 2;

/**
 * Static-world decode. Per splat: rgb bytes = (painted index, pale index, threshold),
 * scale.x = radius / MAX_STD_DEV, scale.y/z bytes = 8 m origin cell. Output colour is the
 * palette index code (idx + 0.5) / 16 in red; the post pass looks up the palette.
 */
export function makeWorldModifier(paintTex: THREE.DataTexture, radiusMul: ReturnType<typeof dyno.dynoFloat>) {
  const uPaint = dyno.dynoSampler2D(paintTex, "wlPaint");
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const d = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, paint: "sampler2D", rmul: "float" },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, paint: uPaint, rmul: radiusMul },
      globals: () => [dyno.defineGsplat],
      statements: ({ inputs, outputs }) => dyno.unindentLines(`
        ${outputs.gsplat} = ${inputs.gsplat};
        if (isGsplatActive(${inputs.gsplat}.flags)) {
          vec3 s = ${inputs.gsplat}.scales;
          const float K = 254.0 / ${(LN_MAX - LN_MIN).toFixed(1)};
          float bx = floor((log(s.y) - (${LN_MIN.toFixed(1)})) * K + 0.5) + 1.0;
          float bz = floor((log(s.z) - (${LN_MIN.toFixed(1)})) * K + 0.5) + 1.0;
          vec3 c = ${inputs.gsplat}.center + vec3((bx - ${ORIGIN_BIAS.toFixed(1)}) * ${ORIGIN_STEP.toFixed(1)}, 0.0, -(bz - ${ORIGIN_BIAS.toFixed(1)}) * ${ORIGIN_STEP.toFixed(1)});
          ${outputs.gsplat}.center = c;
          ${outputs.gsplat}.scales = vec3(s.x * ${inputs.rmul});
          ${outputs.gsplat}.quaternion = vec4(0.0, 0.0, 0.0, 1.0);
          ivec2 pc = ivec2(floor(vec2(c.x, -c.z) * vec2(${(PAINT_W / PAINT_SPAN).toFixed(8)}, ${(PAINT_H / PAINT_SPAN).toFixed(8)})));
          float paint = 0.0;
          if (pc.x >= 0 && pc.y >= 0 && pc.x < ${PAINT_W} && pc.y < ${PAINT_H}) paint = texelFetch(${inputs.paint}, pc, 0).r * 255.0;
          vec3 code = floor(${inputs.gsplat}.rgba.rgb * 255.0 + 0.5);
          float idx = paint > code.b ? code.r : code.g;
          ${outputs.gsplat}.rgba = vec4((idx + 0.5) / 16.0, 0.0, 0.0, 1.0);
        }
      `),
    });
    return { gsplat: d.outputs.gsplat };
  });
}

/** Dynamic splats: rgb.r byte = palette index, scale.x = radius / MAX_STD_DEV, centre relative to the mesh. */
export function makeDynModifier(radiusMul: ReturnType<typeof dyno.dynoFloat>) {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const d = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, rmul: "float" },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, rmul: radiusMul },
      globals: () => [dyno.defineGsplat],
      statements: ({ inputs, outputs }) => dyno.unindentLines(`
        ${outputs.gsplat} = ${inputs.gsplat};
        if (isGsplatActive(${inputs.gsplat}.flags)) {
          ${outputs.gsplat}.scales = vec3(${inputs.gsplat}.scales.x * ${inputs.rmul});
          ${outputs.gsplat}.quaternion = vec4(0.0, 0.0, 0.0, 1.0);
          float idx = floor(${inputs.gsplat}.rgba.r * 255.0 + 0.5);
          ${outputs.gsplat}.rgba = vec4((idx + 0.5) / 16.0, 0.0, 0.0, 1.0);
        }
      `),
    });
    return { gsplat: d.outputs.gsplat };
  });
}

function mustReplace(src: string, find: string, repl: string): string {
  if (!src.includes(find)) throw new Error("Spark shader patch failed; installed Spark changed: " + find.slice(0, 60));
  return src.replace(find, repl);
}

const FRAGMENT = /* glsl */ `precision highp float;
precision highp int;

#include <splatDefines>

uniform float near;
uniform float far;
uniform bool encodeLinear;
uniform float time;
uniform bool debugFlag;
uniform float maxStdDev;
uniform float minAlpha;
uniform bool disableFalloff;
uniform float falloff;
uniform bool wlSnap;

out vec4 fragColor;

in vec4 vRgba;
in vec2 vSplatUv;
in vec3 vNdc;
flat in uint vSplatIndex;
flat in float adjustedStdDev;

#include <logdepthbuf_pars_fragment>

void main() {
    if (!wlSnap && dot(vSplatUv, vSplatUv) > adjustedStdDev * adjustedStdDev) discard;
    // Raw palette-index code, opaque. No colour management: the post pass decodes it.
    fragColor = vec4(vRgba.rgb, 1.0);
    #include <logdepthbuf_fragment>
}`;

export interface SplatShaderUniforms { wlMinPx: { value: number }; wlSnap: { value: boolean } }

/**
 * Patch the SparkRenderer material: opaque hard discs (or pixel-snapped squares) writing
 * the palette code untouched, with a minimum on-screen radius in pixels.
 */
export function patchSparkShaders(spark: SparkRenderer): SplatShaderUniforms {
  const mat = spark.material as THREE.ShaderMaterial;
  let vs = mat.vertexShader;
  vs = mustReplace(vs, "uniform float focalAdjustment;", "uniform float focalAdjustment;\nuniform float wlMinPx;\nuniform bool wlSnap;");
  vs = mustReplace(vs, "vec2 pixelOffset = position.x * eigenVec1 * scale1 + position.y * eigenVec2 * scale2;",
    "scale1 = max(scale1, wlMinPx);\n    scale2 = max(scale2, wlMinPx);\n    vec2 pixelOffset = position.x * eigenVec1 * scale1 + position.y * eigenVec2 * scale2;");
  vs = mustReplace(vs, "vec3 ndcCenter = clipCenter.xyz / clipCenter.w;", `vec3 ndcCenter = clipCenter.xyz / clipCenter.w;
    if (wlSnap) {
        // Pixel-snapped square: integer side, centre on the pixel grid, so the footprint
        // never changes shape as the splat moves (it only jumps whole pixels).
        float side = max(1.0, floor(scale1 + scale2 + 0.5));
        vec2 pc = (ndcCenter.xy * 0.5 + 0.5) * renderSize;
        vec2 sn = (mod(side, 2.0) > 0.5) ? floor(pc) + 0.5 : floor(pc + 0.5);
        ndcCenter.xy = sn / renderSize * 2.0 - 1.0;
        ndcOffset = (2.0 / scaledRenderSize) * (position.xy * 0.5 * side);
    }`);
  mat.vertexShader = vs;
  mat.fragmentShader = FRAGMENT;
  const u = { wlMinPx: { value: 0.6 }, wlSnap: { value: false } };
  Object.assign(mat.uniforms, u);
  mat.needsUpdate = true;
  return u;
}
