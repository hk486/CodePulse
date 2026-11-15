/**
 * Colour that means something.
 *
 * Two systems carry hue in this interface:
 *
 *   - **Severity**, which says how bad a finding is. It is the loudest
 *     colour on screen and it never appears as decoration.
 *   - **Language identity**, which says what a project is written in. A
 *     project keeps its colour wherever it appears: the tile on the
 *     projects grid, the chip in the detected stack, the bar in the chart.
 *
 * The language palette is deliberately small, six hues plus a neutral, so
 * a screen showing eight languages still reads as one system rather than a
 * rainbow. Anything unmapped falls back to the neutral ink.
 */

/**
 * language -> palette slot.
 *
 * Six hues, grouped by family, so related languages share a colour and a
 * project keeps its identity across the tile, the chip and the bar.
 *
 *   1 amber   the web and its styles
 *   2 violet  python and the functional family
 *   3 teal    go, and the tooling around it
 *   4 rose    the jvm and the dotnet family
 *   5 lime    systems and native code
 *   6 cyan    scripting, data and legacy
 *   0 slate   anything that is a document rather than code
 *
 * The scanner reports about sixty languages. They are deliberately folded
 * into six: a screen showing eight languages still reads as one system
 * rather than a rainbow, and the label is always there next to the colour.
 */
const BY_NAME: Record<string, number> = {
  // the web and its styles
  typescript: 1,
  javascript: 1,
  jsx: 1,
  tsx: 1,
  vue: 1,
  svelte: 1,
  astro: 1,
  marko: 1,
  html: 1,
  css: 1,
  dart: 1,
  swift: 1,

  // python and the functional family
  python: 2,
  julia: 2,
  haskell: 2,
  ocaml: 2,
  fsharp: 2,
  elm: 2,
  purescript: 2,
  scheme: 2,
  racket: 2,
  clojure: 2,
  elixir: 2,
  erlang: 2,
  r: 2,
  notebook: 2,
  'r-markdown': 2,
  stata: 2,

  // go, and the tooling around it
  go: 3,
  golang: 3,
  docker: 3,
  terraform: 3,
  shell: 3,
  powershell: 3,
  batch: 3,
  make: 3,
  cmake: 3,
  gradle: 3,

  // the jvm and the dotnet family
  java: 4,
  kotlin: 4,
  scala: 4,
  groovy: 4,
  csharp: 4,
  'c#': 4,
  vbnet: 4,
  vb6: 4,
  basic: 4,

  // systems, native and legacy
  rust: 5,
  zig: 5,
  nim: 5,
  odin: 5,
  c3: 5,
  d: 5,
  crystal: 5,
  c: 5,
  'c++': 5,
  cpp: 5,
  'objective-c': 5,
  verilog: 5,
  systemverilog: 5,
  vhdl: 5,
  assembly: 5,
  ada: 5,
  fortran: 6,
  cobol: 6,
  pascal: 6,
  solidity: 5,
  move: 5,


  // the scripting family and the data languages
  ruby: 6,
  php: 6,
  perl: 6,
  lua: 6,
  raku: 6,
  tcl: 6,
  sql: 6,
  graphql: 6,
  protobuf: 6,
  gdscript: 6,
  gml: 6,
}

const NAMES = Object.keys(BY_NAME)

/**
 * The palette slot for a language, 0 for the neutral fallback.
 *
 * Compound labels such as "typescript/react" resolve to the first language
 * they contain, but the match has to be on a word boundary: otherwise
 * "secrets" would match "c" and come out in the wrong colour.
 */
export function languageSlot(language: string | undefined | null): number {
  if (!language) return 0
  const key = String(language).trim().toLowerCase()
  if (BY_NAME[key]) return BY_NAME[key]
  for (const name of NAMES) {
    const pattern = new RegExp(`(^|[^a-z])${name.replace(/[+\-]/g, '\\$&')}([^a-z]|$)`)
    if (pattern.test(key)) return BY_NAME[name]
  }
  return 0
}

/** The solid colour for a language. */
export function languageColor(language: string | undefined | null): string {
  return `rgb(var(--lang-${languageSlot(language)}))`
}

/** A translucent wash of the language colour, for a tile behind an icon. */
export function languageWash(language: string | undefined | null): string {
  return `rgb(var(--lang-${languageSlot(language)}) / 0.14)`
}

/**
 * A category or a source, written out for people.
 *
 * The scanner reports categories as "CODE_QUALITY" and layers as "infra",
 * which are for machines. This turns them into words.
 */
export function humanise(value: string | undefined | null): string {
  const text = String(value || '').replace(/[_-]+/g, ' ').trim().toLowerCase()
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The name of a language, written the way its author writes it.
 *
 * The scanner reports "typescript" and "csharp"; people write "TypeScript"
 * and "C#".
 */
const LANGUAGE_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  java: 'Java',
  kotlin: 'Kotlin',
  scala: 'Scala',
  groovy: 'Groovy',
  clojure: 'Clojure',
  go: 'Go',
  rust: 'Rust',
  zig: 'Zig',
  c: 'C',
  'c++': 'C++',
  csharp: 'C#',
  'objective-c': 'Objective-C',
  ruby: 'Ruby',
  php: 'PHP',
  perl: 'Perl',
  lua: 'Lua',
  swift: 'Swift',
  dart: 'Dart',
  elixir: 'Elixir',
  erlang: 'Erlang',
  haskell: 'Haskell',
  julia: 'Julia',
  r: 'R',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  markdown: 'Markdown',
  shell: 'Shell',
  docker: 'Dockerfile',
  terraform: 'Terraform',
  // The languages the scanner names from its open table.
  powershell: 'PowerShell',
  solidity: 'Solidity',
  tcl: 'Tcl',
  fortran: 'Fortran',
  fsharp: 'F#',
  vbnet: 'Visual Basic .NET',
  assembly: 'Assembly',
  ada: 'Ada',
  cobol: 'COBOL',
  pascal: 'Pascal',
  crystal: 'Crystal',
  nim: 'Nim',
  elm: 'Elm',
  ocaml: 'OCaml',
  scheme: 'Scheme',
  racket: 'Racket',
  purescript: 'PureScript',
  latex: 'LaTeX',
  batch: 'Batch',
  notebook: 'Notebook',
  protobuf: 'Protocol Buffers',
  starlark: 'Starlark',
  graphql: 'GraphQL',
}

export function languageName(language: string | undefined | null): string {
  const key = String(language || '').toLowerCase()
  return LANGUAGE_NAMES[key] || humanise(language)
}

/**
 * The facets, each with a hue.
 *
 * A facet says which layer of a project a finding came from. There are six
 * layers and six hues, one each, so a layer keeps its colour wherever it
 * appears and the chart never has two identical bars.
 */
const FACET_SLOTS: Record<string, number | null> = {
  code: 6,
  config: 1,
  database: 2,
  infra: 3,
  secrets: 4,
  dependencies: 5,
}

/** The solid colour for a facet. */
export function facetColor(facet: string | undefined | null): string {
  const slot = FACET_SLOTS[String(facet || '').toLowerCase()]
  return `rgb(var(--lang-${slot == null ? 0 : slot}))`
}

/** A translucent wash of the facet colour. */
export function facetWash(facet: string | undefined | null): string {
  const slot = FACET_SLOTS[String(facet || '').toLowerCase()]
  return `rgb(var(--lang-${slot == null ? 0 : slot}) / 0.14)`
}

/**
 * A metric keeps its colour across screens.
 *
 * The dashboard and the reports page show the same four numbers, so the
 * rule above each card doubles as a key: amber always means reports,
 * violet always means findings.
 */
const METRIC_COLORS: Record<string, string> = {
  projects: 'rgb(var(--accent))',
  reports: 'rgb(var(--lang-1))',
  findings: 'rgb(var(--lang-2))',
  critical: 'rgb(var(--severity-critical))',
  high: 'rgb(var(--severity-high))',
  medium: 'rgb(var(--severity-medium))',
  low: 'rgb(var(--severity-low))',
  positive: 'rgb(var(--severity-positive))',
}

export function metricColor(metric: string): string {
  return METRIC_COLORS[metric.toLowerCase()] ?? 'rgb(var(--accent))'
}

/**
 * The category colours for a breakdown that is not about languages.
 *
 * A category is coloured by its name, so the tile in the breakdown and the
 * badge in the table always agree, no matter what order the rows arrive in.
 */
const CATEGORY_SLOTS = [3, 1, 2, 4, 5, 6]

function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return hash
}

/** The palette slot for a category. */
export function categorySlot(category: string | undefined | null): number {
  // The raw value is "CODE_QUALITY" and the display value is "Code
  // Quality". Both have to land on the same hue, so normalise before
  // hashing.
  const key = String(category || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!key) return 0
  return CATEGORY_SLOTS[hashName(key) % CATEGORY_SLOTS.length]
}

export function categoryColor(category: string | undefined | null): string {
  return `rgb(var(--lang-${categorySlot(category)}))`
}

export function categoryWash(category: string | undefined | null): string {
  return `rgb(var(--lang-${categorySlot(category)} / 0.14))`
}
