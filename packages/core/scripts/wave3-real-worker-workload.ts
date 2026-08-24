export function makeCodeContent(lines: number, marker: string): string {
  const content = [`let ${marker}: number = 0`]
  for (let index = 1; index < lines; index++) {
    content.push(`const VALUE_${index}: number = ${index}`)
  }
  return content.join("\n")
}

export function makeWarmAppendWorkload(
  lines: number,
  updateCount: number,
): { initial: string; updates: string[]; finalMarker: string } {
  const initial = makeCodeContent(lines, "WARM_INITIAL")
  const updates: string[] = []
  let content = initial
  let finalMarker = "WARM_INITIAL"

  for (let index = 0; index < updateCount; index++) {
    finalMarker = `WARM_FINAL_${index}`
    content += `\nconst ${finalMarker}: number = ${lines + index}`
    updates.push(content)
  }

  return { initial, updates, finalMarker }
}
