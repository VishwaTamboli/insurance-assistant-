# 01. Project setup

> **Roadmap step 0** · Files: [`package.json`](../package.json), [`tsconfig.json`](../tsconfig.json),
> [`.env.example`](../.env.example), [`src/config.ts`](../src/config.ts)
>
> Written after the step was done, from the code.

## What we built and why

An empty TypeScript project that runs `.ts` files directly and reads secrets from a `.env`
file. Every later piece is a small script started with `npm run <name>`, so this is the base
they all share. There's no framework and no HTTP server: just scripts.

## New ideas

| Idea | In one line |
|---|---|
| Run TypeScript without building | `tsx` runs a `.ts` file directly. `tsc` only checks types (`noEmit`), so there's no `dist/` folder. |
| ES modules | `"type": "module"` in `package.json` means `import`/`export`, and `await` works at the top level of a file, outside any function. |
| `.ts` in imports | `import { pool } from './pool.ts'`: Node needs the real file name. `allowImportingTsExtensions` in `tsconfig.json` lets TypeScript accept it. |
| `.env` and `.env.example` | Secrets live in `.env`, which git ignores. `.env.example` is the committed template, with the values left empty. |

## Packages

| Package | What it's for |
|---|---|
| `typescript` | the type checker: `npm run typecheck` runs `tsc --noEmit` |
| `tsx` | runs `.ts` files directly, like `node` but for TypeScript |
| `@types/node` | types for Node's built-in modules (`fs`, `path`, `crypto`…) |

There's no `dotenv`. Node 20.12+ can read `.env` by itself:

| Method | What it does |
|---|---|
| `process.loadEnvFile()` | reads `.env` and puts each `NAME=value` line into `process.env`; throws if there's no `.env` file |

## Our code: `src/config.ts`

| Part | What it does |
|---|---|
| `try { process.loadEnvFile() } catch {}` | loads `.env` if it exists; a missing file is fine until a value is needed |
| `required(name)` | returns the variable, or throws `Missing env var X. Copy .env.example to .env and fill it in.` |
| `config.databaseUrl`, `config.googleApiKey` | **getters**: each value is read only when some code uses it |

**Why getters:** the database scripts need only `DATABASE_URL`. With getters, they work before
you even have a Gemini key; only a script that reads `config.googleApiKey` fails without one.

## Run it

```bash
npm install
cp .env.example .env     # then paste your Gemini key after GOOGLE_API_KEY=
npm run typecheck
```

**Expected:** `typecheck` prints nothing. No output means no type errors.

To check the key is set without printing it on screen:

```bash
grep -qE '^GOOGLE_API_KEY=.+' .env && echo "key is set"
```

## Check yourself

<details>
<summary>Why does <code>npm run typecheck</code> never create JavaScript files?</summary>

`tsconfig.json` has `"noEmit": true`: `tsc` only checks the types. `tsx` runs the code.
</details>

<details>
<summary><code>.env</code> is git-ignored. How does a new developer know which variables to set?</summary>

From `.env.example`, which is committed. It lists every variable with an empty value and a comment.
</details>

---

[Index](README.md) · [Next: the database and the made-up policies →](02-database-and-policies.md)
