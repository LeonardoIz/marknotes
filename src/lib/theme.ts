export type Theme = "system" | "light" | "dark";
export const THEME_KEY = "notes:theme";

/** Sets data-theme on <html> before the first paint (inlined in the layout's head). */
export const themeScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
