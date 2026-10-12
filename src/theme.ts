import { useSyncExternalStore } from 'react';
export type Theme='light'|'dark';
export type ThemeMode=Theme|'system';
export function readThemeMode():ThemeMode {
  try {const saved=localStorage.getItem('cet6:theme');if(saved==='dark'||saved==='light')return saved;}catch{}
  return 'system';
}
export function readTheme():Theme {return readThemeMode()==='system'?((typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'):readThemeMode() as Theme;}
export function applyTheme(){const theme=readTheme();document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#191b1e':'#fafaf9');}
export function saveTheme(mode:ThemeMode){try{localStorage.setItem('cet6:theme',mode);}catch{}applyTheme();window.dispatchEvent(new Event('cet6:theme'));}
function subscribe(change:()=>void){const media=matchMedia('(prefers-color-scheme: dark)');const sync=()=>{applyTheme();change();};media.addEventListener('change',sync);window.addEventListener('storage',sync);window.addEventListener('cet6:theme',sync);applyTheme();return()=>{media.removeEventListener('change',sync);window.removeEventListener('storage',sync);window.removeEventListener('cet6:theme',sync);};}
export function useTheme(){const theme=useSyncExternalStore(subscribe,readTheme);const mode=useSyncExternalStore(subscribe,readThemeMode);return {theme,mode};}
