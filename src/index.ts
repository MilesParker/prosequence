import { loadDiscourseSpace } from './loader'
import { printDiscourseSpace } from './print'

const path = process.argv[2]
if (!path) {
  console.error('Usage: ts-node src/index.ts <path-to-yaml>')
  process.exit(1)
}

const ds = loadDiscourseSpace(path)
printDiscourseSpace(ds)
