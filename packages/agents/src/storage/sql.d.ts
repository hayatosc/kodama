/** SQL migration files are bundled as text. */
declare module '*.sql' {
  const text: string
  export default text
}
