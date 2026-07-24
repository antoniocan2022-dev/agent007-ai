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
      {/* UPGRADE #125 — CRT scanlines removed for performance (was causing GPU repaint on every frame) */}
    </>
  )
}
