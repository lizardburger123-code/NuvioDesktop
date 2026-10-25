// GSAP 3.15 (gsap.com, standard no-charge licence), vendored UMD build.
import * as umd from "./gsap.umd.js";

const gsap = umd.gsap || umd.default || window.gsap;
if (typeof window !== "undefined" && !window.gsap) window.gsap = gsap;
export { gsap };
export default gsap;
