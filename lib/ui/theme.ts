/**
 * Page theme sampling. Our UI should look like part of the chat it sits in, so
 * instead of hard-coded colours we read what the page actually renders:
 * background, text colour, font, corner radius and the send button's accent,
 * and expose them as CSS variables on our shadow host.
 */

export interface Theme {
  bg: string;
  fg: string;
  accent: string;
  accentFg: string;
  font: string;
  radius: number;
  dark: boolean;
}

type RGBA = [number, number, number, number];

let _canvas: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour → RGBA, via a 1px canvas (handles oklch, color-mix, var results…). */
export function parseColor(css: string): RGBA | null {
  if (!css) return null;
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(css.trim());
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return [+rgb[1]!, +rgb[2]!, +rgb[3]!, a];
  }
  if (_canvas === undefined) {
    try {
      _canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    } catch {
      _canvas = null;
    }
  }
  if (!_canvas) return null;
  try {
    _canvas.clearRect(0, 0, 1, 1);
    _canvas.fillStyle = '#000';
    _canvas.fillStyle = css;
    _canvas.fillRect(0, 0, 1, 1);
    const d = _canvas.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  } catch {
    return null;
  }
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export function luminance([r, g, b]: RGBA): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
const css = ([r, g, b]: RGBA) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;

/** First opaque background colour walking up from `el`. */
function backdrop(el: Element | null): RGBA {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = parseColor(getComputedStyle(n).backgroundColor);
    if (c && c[3] > 0.95) return c;
  }
  const root = parseColor(getComputedStyle(document.documentElement).backgroundColor);
  if (root && root[3] > 0.95) return root;
  const prefersDark = matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? [32, 33, 35, 1] : [255, 255, 255, 1];
}

/**
 * Sample the theme around `anchor` (the composer). `sendButton` provides the
 * accent when it is a real filled colour; otherwise the accent is the text
 * colour, which is what ChatGPT-style monochrome UIs do.
 */
export function sampleTheme(anchor: Element | null, sendButton?: Element | null): Theme {
  const bg = backdrop(anchor);
  const text = anchor ?? document.body;
  const fg = parseColor(getComputedStyle(text).color) ?? (luminance(bg) < 0.4 ? [236, 236, 236, 1] as RGBA : [32, 33, 35, 1] as RGBA);
  // Composer first: some apps (Gemini) leave <body> on the browser default serif and
  // set the real font on the app's own elements.
  const font = getComputedStyle(text).fontFamily || getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';

  let accent: RGBA = fg;
  let accentFg: RGBA = bg;
  if (sendButton) {
    const s = getComputedStyle(sendButton);
    const bgc = parseColor(s.backgroundColor);
    if (bgc && bgc[3] > 0.9 && contrast(bgc, bg) > 1.4) {
      accent = bgc;
      accentFg = parseColor(s.color) ?? (luminance(bgc) > 0.5 ? [0, 0, 0, 1] : [255, 255, 255, 1]);
      if (contrast(accent, accentFg) < 3) accentFg = luminance(accent) > 0.5 ? [0, 0, 0, 1] : [255, 255, 255, 1];
    }
  }

  const scopeRadius = parseFloat(getComputedStyle(anchor?.parentElement ?? document.body).borderRadius) || 0;
  const radius = Math.min(14, Math.max(8, scopeRadius || 10));

  return {
    bg: css(bg),
    fg: css(fg),
    accent: css(accent),
    accentFg: css(accentFg),
    font,
    radius,
    dark: luminance(bg) < 0.4,
  };
}

export function applyTheme(host: HTMLElement, th: Theme): void {
  const s = host.style;
  s.setProperty('--bg', th.bg);
  s.setProperty('--fg', th.fg);
  s.setProperty('--accent', th.accent);
  s.setProperty('--accent-fg', th.accentFg);
  s.setProperty('--font', th.font);
  s.setProperty('--radius', `${th.radius}px`);
  s.setProperty('color-scheme', th.dark ? 'dark' : 'light');
}
