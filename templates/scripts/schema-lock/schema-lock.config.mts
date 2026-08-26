/**
 * The schema-lock module's ONE per-repo fact: what counts as this
 * repository's shared schema surface. Everything else in the module is the
 * playbook's, byte-for-byte (UPDATE.md Class A); THIS file is the repo's
 * own, and a sync never touches it.
 *
 * The predicate answers for one changed path at a time. Declare the surface
 * on which two in-flight branches collide OUTSIDE git — migration numbering,
 * hand-applied DDL, a generated journal — not merely files that merge badly:
 * an ordinary merge conflict is loud, local and undoable, and needs no lock.
 *
 * The surface is the import closure the ORM actually reads, not the one
 * path its config names. Follow the entry point's imports and re-exports
 * before writing the tests: `export * from "./sibling"` makes a two-file
 * surface look like one, and a predicate matching only the entry point
 * answers green for a branch that changes the schema through the sibling.
 *
 * Worked example (a real adopted repo: hand-applied `db/*.sql` plus forward-only,
 * checksummed `db/migrations/**`):
 *
 *   const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
 *   if (normalized.startsWith("db/migrations/")) return true;
 *   return /^db\/[^/]+\.sql$/.test(normalized);
 */
export function isSchemaPath(file: string): boolean {
  // {{SCHEMA_SURFACE}} — adoption replaces this throw with the repo's own
  // tests, agreed with the human. Unfilled, the check fails LOUDLY rather
  // than answering green while watching nothing.
  throw new Error(
    "schema-lock.config.mts: this repo's schema surface is not declared " +
      `(asked about ${JSON.stringify(file)}) — see the worked example in this file`,
  );
}
