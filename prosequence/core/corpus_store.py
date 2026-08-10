#!/usr/bin/env python3
"""Read/write primitives for the corpus git repository (Directive 1c).

The three corpora live in their own nested git repository (see
`discourse-spaces/.git`). Every commit in that repository is a graph change,
which is what makes "did head move" a usable conflict check.

CorpusStore is a thin object-layer wrapper over that repository: blob -> tree
-> commit, no index, no `checkout`, no subprocess. It provides exactly the
primitives the writer in 1d sits on. It does NOT validate, diff, or implement
any patch/agent logic — that is 1d's job, deliberately kept out of here.

Commit identity for machine writes is fixed to the harness signature; human
commits (e.g. genesis, hand-edits committed by the operator) use the normal
git config and are made outside this module.
"""
from __future__ import annotations

import os
from typing import Optional, cast

import pygit2
from pygit2.enums import FileMode, SortMode


# Identity stamped on every commit written through this module (machine writes).
HARNESS_NAME = "prosequence-harness"
HARNESS_EMAIL = "harness@prosequence.local"

# The store's one ref, both read and write. commit() already hardcodes this as
# its write target; every read default below resolves it explicitly too,
# rather than trusting `repo.head.target` (whatever a human has `git
# checkout`-ed in their own working copy) — this repo has one ref that
# matters, and the store must not silently reinterpret "head" as something
# else just because a human is looking at a different branch.
MAIN_REF = "refs/heads/main"


class HeadMoved(Exception):
    """Raised by commit() when parent_sha is not the current head.

    This is the whole conflict check. 1d turns it into a distinguishable
    result type; here it is just an exception and no commit is created.
    """


class WorkingTreeDirty(Exception):
    """Raised by commit() when the on-disk file differs from HEAD's blob.

    Signals an uncommitted hand-edit that a blind commit would discard.
    commit() writes nothing when this is raised.
    """


class CorpusStore:
    def __init__(self, repo_path: str):
        # Resolve the containing repository (accepts the workdir or the .git dir).
        discovered = pygit2.discover_repository(repo_path)
        if discovered is None:
            raise ValueError(f"no git repository at {repo_path!r}")
        self.repo = pygit2.Repository(discovered)
        if self.repo.is_bare:
            raise ValueError("corpus repository must have a working tree")
        # Absolute path to the working tree; used for the on-disk writes/reads.
        self.workdir = os.path.abspath(self.repo.workdir)

    # -- helpers -----------------------------------------------------------

    def _commit(self, sha: Optional[str]) -> pygit2.Commit:
        """Resolve a sha (or main's tip when None) to a Commit object."""
        oid = self.repo.references[MAIN_REF].target if sha is None else sha
        obj = self.repo[oid]
        return obj.peel(pygit2.Commit)

    @staticmethod
    def _blob_oid(tree: pygit2.Tree, name: str):
        """Blob oid for `name` in `tree`, or None if absent."""
        if name in tree:
            return tree[name].id
        return None

    def _worktree_bytes(self, name: str) -> Optional[bytes]:
        """Bytes of the on-disk working-tree file, or None if it does not exist."""
        path = os.path.join(self.workdir, name)
        if not os.path.exists(path):
            return None
        with open(path, "rb") as fh:
            return fh.read()

    # -- read side ---------------------------------------------------------

    def head(self) -> str:
        """main's current commit sha — explicitly refs/heads/main, regardless of
        what a human currently has checked out in the working tree."""
        return str(self.repo.references[MAIN_REF].target)

    def read(self, name: str, sha: Optional[str] = None) -> str:
        """Text of corpus `name` at `sha` (defaults to head).

        `repo[sha].tree[name].data` decoded. No checkout.
        """
        commit = self._commit(sha)
        entry = commit.tree[name]  # raises KeyError if absent
        # pygit2 types repo[oid] as the base Object; a tree entry looked up
        # by corpus name is a blob, and only Blob carries `.data`.
        return cast(pygit2.Blob, self.repo[entry.id]).data.decode("utf-8")

    def list_corpora(self, sha: Optional[str] = None) -> list[str]:
        """Names of the corpora present at `sha` (defaults to head).

        A corpus is a top-level `*.v2.yaml` blob; the `migrations/` subtree and
        anything else is excluded.
        """
        commit = self._commit(sha)
        # `e.name` is Optional in pygit2's types; a real tree entry always
        # has one, but the guard is what makes that checkable.
        names = [
            e.name
            for e in commit.tree
            if e.type_str == "blob"
            and e.name is not None
            and e.name.endswith(".v2.yaml")
        ]
        return sorted(names)

    def log(self, name: str) -> list[tuple[str, str, int]]:
        """(sha, message, timestamp) for every commit that touched `name`.

        Walks from main's tip (not whatever is checked out — see MAIN_REF); a
        commit "touches" `name` when its blob oid for that path differs from
        every parent's (add, modify, or delete). The root commit touches `name`
        if the path is present in it.
        """
        out: list[tuple[str, str, int]] = []
        for commit in self.repo.walk(self.repo.references[MAIN_REF].target, SortMode.TIME):
            cur = self._blob_oid(commit.tree, name)
            parents = commit.parents
            if not parents:
                touched = cur is not None
            else:
                touched = any(
                    self._blob_oid(p.tree, name) != cur for p in parents
                )
            if touched:
                out.append(
                    (str(commit.id), commit.message.rstrip("\n"), commit.commit_time)
                )
        return out

    # -- write side --------------------------------------------------------

    def commit(self, name: str, text: str, message: str, parent_sha: str) -> str:
        """Commit `text` as corpus `name`, returning the new commit sha.

        Two guards run before anything is written:

        * HeadMoved  — `parent_sha` is not the current head. The conflict check.
        * WorkingTreeDirty — the on-disk file differs from HEAD's blob, i.e. an
          uncommitted hand-edit a commit would silently discard.

        On success it does two writes with the same bytes, so they cannot
        diverge: the blob into the object database (via a new tree/commit on
        refs/heads/main), and those bytes to the working-tree file. The index
        is then reconciled to the new tree so `git status` stays clean and the
        operator's own hand-edits remain the only thing it reports. The commit
        is still built purely at the object layer (blob -> tree -> commit); the
        index is never a source, only reconciled after the fact.
        """
        current = self.head()
        if parent_sha != current:
            raise HeadMoved(
                f"parent_sha {parent_sha} is not head {current}"
            )

        head_commit = self.repo[current].peel(pygit2.Commit)
        head_oid = self._blob_oid(head_commit.tree, name)
        head_bytes = (cast(pygit2.Blob, self.repo[head_oid]).data
                      if head_oid is not None else None)

        if self._worktree_bytes(name) != head_bytes:
            raise WorkingTreeDirty(
                f"working-tree file {name!r} differs from HEAD; refusing to "
                f"overwrite an uncommitted hand-edit"
            )

        data = text.encode("utf-8")

        # Object-database write: new blob, new tree (HEAD's tree with `name`
        # replaced), new commit advancing main.
        blob_oid = self.repo.create_blob(data)
        builder = self.repo.TreeBuilder(head_commit.tree)
        builder.insert(name, blob_oid, FileMode.BLOB)
        tree_oid = builder.write()

        sig = pygit2.Signature(HARNESS_NAME, HARNESS_EMAIL)
        new_oid = self.repo.create_commit(
            "refs/heads/main", sig, sig, message, tree_oid, [head_commit.id]
        )

        # Working-tree write: identical bytes to the file on disk.
        with open(os.path.join(self.workdir, name), "wb") as fh:
            fh.write(data)

        # Index reconciliation: advance the index to the just-committed tree so
        # `git status` is clean and reports only the operator's later hand-edits.
        self.repo.index.read_tree(tree_oid)
        self.repo.index.write()

        return str(new_oid)
