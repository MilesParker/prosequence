import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolved from THIS FILE, not from process.cwd(): the corpus repo sits beside
// the config, and where the server happened to be launched from is not a fact
// about where the corpora are. With cwd, starting vite from any other directory
// silently pointed this at a path that does not exist, every git call failed,
// and every corpus fell through to a 404 that looked like a missing model.
const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), 'discourse-spaces')

// A managed corpus is served from git, not from the working tree.
//
// An ingest commits, lands on its own branch, and main is rewound — unreviewed
// work must not sit on main, and leaving the tree pointing at a branch would
// trip the store's dirty-tree guard and break the next run. The consequence was
// that `discourse-spaces/gaza.v2.yaml` on disk is the corpus as it was BEFORE
// the run, so `?model=gaza` showed a stale graph (140 nodes on disk against 184
// committed) and looking at what you just made meant checking something out.
//
// So the dev server resolves the newest commit touching that file across ALL
// refs and streams that blob instead. `?model=<name>` is unchanged and needs no
// step after a run: refresh and the newest ingest is there. Nothing is checked
// out, no ref moves, the working tree stays clean, and the commit policy is
// untouched — this only changes which bytes the viewer is handed.
//
// Only top-level `discourse-spaces/<slug>.v2.yaml` is intercepted. The slug
// pattern excludes `/`, so `scratch/` falls through to ordinary static serving:
// unmanaged corpora are not in git and must keep being read from disk.
function latestCorpus(): Plugin {
  const MANAGED = /^\/discourse-spaces\/([A-Za-z0-9_-]+)\.v2\.yaml$/

  return {
    name: 'prosequence-latest-corpus',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = MANAGED.exec((req.url ?? '').split('?')[0])
        if (!match) return next()

        const file = `${match[1]}.v2.yaml`
        const git = (args: string[]) =>
          execFileSync('git', ['-C', CORPUS_DIR, ...args], { encoding: 'utf8' })

        try {
          // --all so an ingest branch counts; -1 so it is the newest of them.
          const sha = git(['log', '--all', '-1', '--format=%H', '--', file]).trim()
          if (!sha) return next()   // never committed — let static serving try
          const body = git(['show', `${sha}:${file}`])
          res.setHeader('Content-Type', 'text/yaml; charset=utf-8')
          // The point is that a refresh after a run shows the run.
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
        } catch {
          next()   // not a git repo, git missing, path absent: serve from disk
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), latestCorpus()],
  server: {
    port: 5173,
  },
})
