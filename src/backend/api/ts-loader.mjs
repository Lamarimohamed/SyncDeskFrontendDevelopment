import { access } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"

const isRelative = (specifier) =>
  specifier.startsWith("./") || specifier.startsWith("../")

export async function resolve(specifier, context, nextResolve) {
  if (!isRelative(specifier) || specifier.endsWith(".ts")) {
    return nextResolve(specifier, context)
  }

  try {
    const parentPath = fileURLToPath(context.parentURL)
    const candidate = new URL(specifier + ".ts", pathToFileURL(parentPath))
    await access(fileURLToPath(candidate))
    return nextResolve(candidate.href, context)
  } catch {
    return nextResolve(specifier, context)
  }
}
