export type Theme='light'|'dark';
export function readTheme():Theme {
  try {const saved=localStorage.getItem('cet6:theme');if(saved==='dark'||saved==='light')return saved;}catch{}
  return 'light';
}
export function saveTheme(theme:Theme){try{localStorage.setItem('cet6:theme',theme);}catch{}}
