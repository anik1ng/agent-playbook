// Flat config, written for ESLint 9 + typescript-eslint 8. Re-check both
// majors before rendering — the flat-config API and the `configs.*` names are
// version-bound, and a config written for the wrong major fails loudly at the
// first run rather than quietly.
//
// Rendered ONCE at adoption and then this repo's own file: a sync never
// overwrites it (ADOPT.md, "The static gate"). Delete what does not apply,
// add the repo's own rules, and keep the reason next to anything you relax.
//
// The shape is deliberate:
//
//   - TYPE-AWARE by default (`strictTypeChecked` + `stylisticTypeChecked`).
//     The whole bargain of this workflow is that no human reads the diffs, so
//     the machine has to carry the guarantee. Type-aware rules are the ones
//     that catch what review would have: a floating promise, an `any` that
//     spread three files, a condition that is always true. They cost real
//     seconds per run — that is the price of the guarantee, not a regression.
//   - `eslint-config-prettier` LAST, always. It switches off the stylistic
//     rules Prettier already owns; anywhere earlier and the two tools argue
//     over the same lines forever.
//   - Tests get a narrow relaxation block, because a test legitimately does
//     what production code must not: stub a partial object, cast a fixture,
//     assert non-null on something it just constructed. Relaxing those rules
//     everywhere would be giving up the guarantee to make the tests quiet.
//   - Plain JS files are opted OUT of type-aware rules: they are usually
//     outside tsconfig's graph (config files, scripts), and a type-aware rule
//     on a file the program does not include is an error about the setup, not
//     about the code.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Generated, vendored and downloaded trees. Add this repo's own — a build
  // output directory that is not listed here is linted on every run and
  // reports errors nobody wrote.
  { ignores: ["dist/**", "build/**", "coverage/**"] },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Resolves each file's tsconfig by itself, so a repo with several
        // (src, tests, scripts) needs no list here and no updating later.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**"],
    rules: {
      // A fixture is a lie by construction: it stands in for a real object
      // without being one. These four rules exist to stop that lie leaking
      // into production code, which is exactly why they are off HERE and
      // nowhere else.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // `expect(fn()).rejects` and friends read as unhandled promises.
      "@typescript-eslint/unbound-method": "off",
    },
  },

  // NOT relaxed in tests, deliberately: no-floating-promises. A forgotten
  // await in a test is how a suite goes green without having asserted
  // anything — the one failure this workflow cannot afford.

  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettierConfig,
);
