import { useEffect, useRef, useState } from "react";
import type { Showcase } from "./manifest";

// The 3:2 media area of a store card.
//
// Four kinds, per the store contract: a still image, a cross-fading slideshow, a
// short video, or a YouTube link.
//
// Two deliberate behaviours:
//   - Nothing autoplays off-screen. Video only plays while the card is visible,
//     which keeps a grid of twenty cards from spinning up twenty decoders.
//   - YouTube is CLICK TO LOAD. Browsing the store contacts Google zero times;
//     the frame is only created after the user presses play, and it uses the
//     privacy-enhanced nocookie host.

const SLIDE_MS = 3200;

export function MediaCard({ showcase, thumbnail, alt }: {
  showcase?: Showcase;
  thumbnail: string;
  alt: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [slide, setSlide] = useState(0);
  const [ytLoaded, setYtLoaded] = useState(false);

  // Only animate or play while on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const frames = showcase?.type === "slideshow" ? showcase.images : null;
  useEffect(() => {
    if (!frames || !visible || frames.length < 2) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % frames.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [frames, visible]);

  return (
    <div className="ca-media" ref={ref}>
      {(!showcase || showcase.type === "image") && (
        <img src={showcase?.type === "image" ? showcase.image : thumbnail} alt={alt} loading="lazy" />
      )}

      {showcase?.type === "slideshow" &&
        showcase.images.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            loading="lazy"
            className={`ca-slide${i === slide ? " ca-slide-on" : ""}`}
          />
        ))}

      {showcase?.type === "video" && (
        <VideoFrame src={showcase.video} poster={thumbnail} play={visible} />
      )}

      {showcase?.type === "youtube" && !ytLoaded && (
        <>
          <img src={thumbnail} alt={alt} loading="lazy" />
          <button
            type="button"
            className="ca-play"
            onClick={(e) => { e.stopPropagation(); setYtLoaded(true); }}
            aria-label="Play video"
          >
            <span className="ca-play-badge">▶</span>
            <span className="ca-play-note">Plays from YouTube</span>
          </button>
        </>
      )}
      {showcase?.type === "youtube" && ytLoaded && (
        <iframe
          title={alt}
          // nocookie host, and no related-video trawl at the end.
          src={`https://www.youtube-nocookie.com/embed/${showcase.youtubeId}?autoplay=1&rel=0&modestbranding=1`}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-presentation"
          style={{ width: "100%", height: "100%", border: 0 }}
        />
      )}
    </div>
  );
}

function VideoFrame({ src, poster, play }: { src: string; poster: string; play: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (play) void v.play().catch(() => {});
    else v.pause();
  }, [play]);
  return <video ref={ref} src={src} poster={poster} muted loop playsInline preload="none" />;
}
