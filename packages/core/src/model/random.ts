/**
 * A small seeded random generator for coefficient sampling: xoshiro128**
 * (Blackman and Vigna), seeded through splitmix32, with Box–Muller normals.
 * The same seed always gives the same sequence, so sampled bands are
 * reproducible.
 */

export interface Random {
  /** The next 32-bit output. */
  nextUint32(): number;
  /** Uniform on the open interval (0, 1), with 53 random bits. */
  uniform(): number;
  /** Standard normal. */
  normal(): number;
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** A generator from xoshiro128**'s four-word state (not all zero). */
export function xoshiro128ss(state: readonly [number, number, number, number]): Random {
  let [s0, s1, s2, s3] = state.map((word) => word >>> 0) as [number, number, number, number];
  if ((s0 | s1 | s2 | s3) === 0) throw new RangeError("xoshiro128** needs a non-zero state");
  let spare: number | null = null;

  const nextUint32 = () => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };
  const uniform = () => {
    const high = nextUint32() >>> 5; // 27 bits
    const low = nextUint32() >>> 6; // 26 bits
    return (high * 67_108_864 + low + 0.5) / 9_007_199_254_740_992;
  };
  const normal = () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    const radius = Math.sqrt(-2 * Math.log(uniform()));
    const angle = 2 * Math.PI * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
  return { nextUint32, uniform, normal };
}

/** A generator from a 32-bit seed, spread over the state with splitmix32. */
export function createRandom(seed: number): Random {
  let x = seed >>> 0;
  const splitmix32 = () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  return xoshiro128ss([splitmix32(), splitmix32(), splitmix32(), splitmix32()]);
}
