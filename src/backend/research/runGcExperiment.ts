import { resolve } from "node:path"

import {
  defaultGcExperimentConfig,
  runGcExperimentMatrix,
  writeGcExperimentArtifacts,
} from "./gcExperiment"

const parseArgs = (
  argv: string[],
): { out: string; seeds?: number[] } => {
  const outIndex = argv.indexOf("--out")
  if (outIndex < 0 || !argv[outIndex + 1])
    throw new Error("Usage: runGcExperiment.ts --out <directory> [--seeds 11,23,37]")

  const seedsIndex = argv.indexOf("--seeds")
  const seeds = seedsIndex >= 0 && argv[seedsIndex + 1]
    ? argv[seedsIndex + 1].split(",").map((value) => Number(value.trim()))
    : undefined

  if (seeds?.some((seed) => !Number.isInteger(seed)))
    throw new Error("Seeds must be integers")

  return { out: resolve(argv[outIndex + 1]), seeds }
}

const args = parseArgs(process.argv.slice(2))
const config = defaultGcExperimentConfig(args.seeds ? { seeds: args.seeds } : {})
const records = runGcExperimentMatrix(config)
writeGcExperimentArtifacts(args.out, config, records)
process.stdout.write(
  `Wrote ${records.length} GC experiment records to ${args.out}\n`,
)
