export interface Theme {
  background: string
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
  }
}
