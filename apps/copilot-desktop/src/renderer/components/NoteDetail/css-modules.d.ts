// Ambient declaration so TypeScript can type-check `import styles from
// '*.module.css'` even when the active tsconfig doesn't pull in
// `vite/client` (e.g. the tests project, which uses vitest globals
// instead of the Vite renderer types).
//
// Matches the shape Vite generates at runtime: an object whose keys
// are the class names declared in the CSS file.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
