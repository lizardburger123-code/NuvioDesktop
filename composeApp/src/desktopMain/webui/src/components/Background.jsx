import { useEffect, useMemo, useRef, useState } from "react";
import { EASE, reduceMotion } from "../lib/motion.js";
import Grainient from "../reactbits/Grainient/Grainient.jsx";
import "./Background.css";

/**
 * The scene behind every screen: a wallpaper (the user's image, the featured title's artwork,
 * or none) washed with the user's three gradient colours, over a slow grainy gradient
 * (React Bits Grainient) in the same colours. A screen can lend its own artwork (a title's
 * backdrop on its details page), which cross-fades in.
 */
export default function Background({ appearance, featured, art, scrolled }) {
  const colors = appearance?.colors || ["#1d2b64", "#6b3fa0", "#e0607e"];
  const mode = appearance?.wallpaper?.mode || "featured";
  const custom = appearance?.wallpaper?.image || null;
  const animate = appearance?.animate !== false;

  const featuredList = useMemo(() => (featured || []).map(item => item.banner).filter(Boolean), [featured]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  useEffect(() => {
    if (mode !== "featured" || featuredList.length < 2 || art) return undefined;
    const timer = window.setInterval(() => setFeaturedIndex(i => (i + 1) % featuredList.length), 14000);
    return () => window.clearInterval(timer);
  }, [mode, featuredList.length, art]);

  const wallpaper = art || (mode === "custom" ? custom : mode === "featured" ? featuredList[featuredIndex % Math.max(1, featuredList.length)] : null);

  // Two stacked images cross-fade whenever the source changes.
  const [layers, setLayers] = useState([{ src: wallpaper, id: 0 }]);
  const idRef = useRef(0);
  useEffect(() => {
    if (!wallpaper) {
      setLayers([]);
      return;
    }
    // Decode off the main thread before swapping, so the cross-fade never waits on a decode.
    const img = new Image();
    let alive = true;
    img.src = wallpaper;
    const swap = () => {
      if (!alive) return;
      idRef.current += 1;
      setLayers(prev => [...prev.slice(-1), { src: wallpaper, id: idRef.current }]);
    };
    (img.decode ? img.decode() : Promise.resolve()).then(swap, swap);
    return () => { alive = false; };
  }, [wallpaper]);

  const lastLayerRef = useRef(null);
  useEffect(() => {
    const node = lastLayerRef.current;
    if (!node || layers.length < 2 || reduceMotion()) return;
    // The new picture settles in over the old one (compositor-only: opacity and scale).
    node.animate(
      [{ opacity: 0, transform: "scale(1.035)" }, { opacity: 1, transform: "none" }],
      { duration: 1100, easing: EASE.glide },
    );
  }, [layers]);

  const grainColors = useMemo(() => ["#06060a", colors[0], colors[1], colors[2], "#06060a"], [colors]);

  return (
    <div className={`scene${scrolled ? " scene-scrolled" : ""}${wallpaper ? " has-wall" : ""}${Number.parseFloat(appearance?.blur) > 0 ? " has-blur" : ""}`} aria-hidden="true">
      <div className="scene-grain">
        <Grainient
          colors={grainColors}
          angle={125}
          speed={animate ? 0.35 : 0}
          flow={0.7}
          softness={1}
          silk={0.4}
          grainAmount={0.06}
          grainAnimated={animate}
          interactive={false}
          clickSwirl={false}
          intro={false}
          dpr={1}
          fps={30}
        />
      </div>
      <div className="scene-walls">
        {layers.map((layer, i) => (
          <img
            key={layer.id}
            ref={i === layers.length - 1 ? lastLayerRef : undefined}
            className="scene-wall"
            src={layer.src}
            alt=""
            decoding="async"
          />
        ))}
      </div>
      <div className="scene-wash" />
      <div className="scene-fade" />
    </div>
  );
}
