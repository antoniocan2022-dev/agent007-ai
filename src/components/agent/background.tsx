'use client'

export function Background() {
  return (
    <>
      {/* Floating gradient orbs */}
      <div
        className="orb orb-cyan orb-1"
        style={{ width: 380, height: 380, top: -120, left: -100 }}
        aria-hidden
      />
      <div
        className="orb orb-purple orb-2"
        style={{ width: 460, height: 460, top: '20vh', right: -160 }}
        aria-hidden
      />
      <div
        className="orb orb-pink orb-3"
        style={{ width: 320, height: 320, bottom: -120, left: '30vw' }}
        aria-hidden
      />
      {/* CRT scanlines overlay (applied to root via .scanlines on body) */}
      <style jsx global>{`
        body::before {
          content: '';
          position: fixed;
          inset: 0;
          pointer-events: none;
          background: repeating-linear-gradient(
            to bottom,
            rgba(0, 240, 255, 0.02) 0px,
            rgba(0, 240, 255, 0.02) 1px,
            transparent 1px,
            transparent 3px
          );
          mix-blend-mode: screen;
          z-index: 100;
          opacity: 0.45;
        }
      `}</style>
    </>
  )
}
