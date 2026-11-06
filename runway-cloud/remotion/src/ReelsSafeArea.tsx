import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';

// Caio's conservative preset from his Instagram screenshot, 2026-11-01.
// Not an official Instagram specification. Applies to future 9:16 edits only.
export const REELS_SAFE_MARGINS = {top: 320, bottom: 480, left: 80, right: 200} as const;
export type SafeRect = {left: number; top: number; width: number; height: number};

export const getReelsSafeRect = (width = 1080, height = 1920): SafeRect => ({
  left: width * 80 / 1080,
  top: height * 320 / 1920,
  width: width * 800 / 1080,
  height: height * 1120 / 1920,
});

// Pass the full swept bounding box (including maximum scale, rotation,
// movement and meaningful glow/shadow), not merely the resting image box.
export const assertReelsSafeBounds = (
  name: string, bounds: SafeRect, width = 1080, height = 1920,
): void => {
  const safe = getReelsSafeRect(width, height);
  const values = [bounds.left, bounds.top, bounds.width, bounds.height, width, height];
  if (values.some(v => !Number.isFinite(v)) || bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0 ||
    bounds.left < safe.left || bounds.top < safe.top ||
    bounds.left + bounds.width > safe.left + safe.width ||
    bounds.top + bounds.height > safe.top + safe.height) {
    throw new Error(`${name}: elemento/animação fora da área segura de Reels. Reposicione ou reduza antes de exportar.`);
  }
};

// Explicit opt-in for layout review only; never mounted in existing videos.
// Remove or set enabled=false for final export. This guide does not detect faces.
export const ReelsSafeAreaGuide: React.FC<{enabled?: boolean}> = ({enabled = false}) => {
  const {width, height} = useVideoConfig();
  if (!enabled) return null;
  const safe = getReelsSafeRect(width, height);
  return <AbsoluteFill style={{pointerEvents: 'none', zIndex: 9999}}>
    <div style={{position: 'absolute', ...safe, border: '3px dashed #ffd54a',
      boxShadow: '0 0 0 9999px rgba(220,35,55,0.28)', boxSizing: 'border-box'}}>
      <div style={{backgroundColor: '#191919', color: '#ffd54a', padding: 12,
        fontFamily: 'Arial', fontSize: 24}}>GUIA • manter elemento e animação dentro desta área</div>
    </div>
  </AbsoluteFill>;
};
