export const COLORS = {
  bg: 'oklch(0.16 0.005 250)',
  panel: 'oklch(0.185 0.006 250)',
  grid: 'oklch(0.24 0.006 250)',
  gridSoft: 'oklch(0.21 0.006 250)',
  text: 'oklch(0.88 0.005 250)',
  muted: 'oklch(0.55 0.005 250)',
  bull: 'oklch(0.90 0.18 150)',
  bear: 'oklch(0.78 0.25 22)',
  accent: 'oklch(0.78 0.14 220)',
  amber: 'oklch(0.80 0.15 85)',
  magenta: 'oklch(0.72 0.18 330)',
  lime: 'oklch(0.85 0.18 120)',
  violet: 'oklch(0.72 0.16 290)',
  teal: 'oklch(0.76 0.11 180)',
  cloudGreen: 'oklch(0.82 0.13 150 / 0.20)',
  cloudRed: 'oklch(0.78 0.15 22 / 0.20)',
  sqMinor: 'oklch(0.65 0.08 260 / 0.45)',
  sqMajor: 'oklch(0.78 0.15 60 / 0.80)',
};

export const COMPARE_COLORS = [
  'oklch(0.78 0.14 220)',
  'oklch(0.80 0.15 85)',
  'oklch(0.72 0.18 330)',
  'oklch(0.85 0.18 120)',
  'oklch(0.72 0.16 290)',
  'oklch(0.76 0.11 180)',
];

// 描画ツールのカラーパレット（固定 5 色）
export const DRAWING_COLORS = ['#FFFFFF', '#FFFF00', '#00FFFF', '#FFC0CB', '#89CC40'] as const;

// 描画の半透明塗り用。hex は rgba へ、oklch など末尾 ) の色はアルファチャンネルを差し込む。
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.endsWith(')') && !color.includes('/')) {
    return color.replace(/\)$/, ` / ${alpha})`);
  }
  return color;
}
