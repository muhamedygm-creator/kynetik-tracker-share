/**
 * Theme switch (2026-10-17): Light, Dark or System per person. The profile holds the choice (it follows the
 * person across devices); the browser keeps a copy in a cookie and localStorage so the page opens in the right
 * theme before it is drawn. Dark is the default. The TV displays are always dark; PDFs keep their print style.
 */
export type ThemeChoice = "light" | "dark" | "system";
export const THEMES: ThemeChoice[] = ["light", "dark", "system"];
export const THEME_COOKIE = "kk_theme";
export const THEME_STORE = "kk.theme";
export const isTheme = (x: unknown): x is ThemeChoice => x === "light" || x === "dark" || x === "system";

/**
 * Runs in <head> before the first paint: picks the theme from the cookie (or this browser's copy), resolves
 * System from the device, and keeps the TV displays dark.
 */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement;if(location.pathname.indexOf("/display")===0){d.dataset.theme="dark";return}var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)/),t=(m&&m[1])||localStorage.getItem("${THEME_STORE}")||"dark";if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";d.dataset.theme=t==="light"?"light":"dark"}catch(e){}})();`;
