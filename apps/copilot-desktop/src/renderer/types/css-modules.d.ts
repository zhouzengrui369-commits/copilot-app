/* Type shim for Vite's CSS Modules import.
   Lets `import styles from './x.module.css'` type-check. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}