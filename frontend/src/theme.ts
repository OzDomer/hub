export interface Theme {
  background: string
  text: string
  glow: string
  core: string
  moon: string
  moonGrumpy: string
}

export function readTheme(): Theme {
  const style = getComputedStyle(document.documentElement)

  function read(name: string): string {
    const value = style.getPropertyValue(name).trim()
    if (value === "") throw new Error(`missing CSS variable ${name} (see styles.css)`)
    return value
  }

  return {
    background: read("--background"),
    text: read("--text"),
    glow: read("--glow"),
    core: read("--core"),
    moon: read("--moon"),
    moonGrumpy: read("--moon-grumpy"),
  }
}
