/**
 * Server-side runtime config for the deliberation viewer.
 *
 * Defaults assume the typical local-dev layout (synod/ui sibling to
 * synod/logs). Each value can be overridden via environment variables —
 * useful when the UI runs in a separate shell from the settler processes.
 */

import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd(), "..");

export const SETTLER_LOG_FILES = (
  process.env.SYNOD_UI_LOG_FILES ??
  "logs/settler-a.log,logs/settler-b.log,logs/settler-c.log"
)
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => ({
    name: path.basename(p),
    path: path.resolve(/*turbopackIgnore: true*/ REPO_ROOT, p),
  }));

export const INJECT_QUESTION_PY = path.resolve(
  /*turbopackIgnore: true*/
  REPO_ROOT,
  process.env.SYNOD_UI_INJECT_PY ?? "settler/tools/inject_question.py"
);

export const SETTLER_PYTHON =
  process.env.SYNOD_UI_PYTHON ??
  path.resolve(
    /*turbopackIgnore: true*/
    REPO_ROOT,
    "settler/.venv/Scripts/python.exe"
  );

export const PRIMARY_AXL_API =
  process.env.SYNOD_UI_AXL_API ?? "http://127.0.0.1:9002";

/** When set, the page polls this AXL daemon to learn the primary settler's pubkey. */
export const PRIMARY_AXL_TARGET_FROM_TOPOLOGY =
  (process.env.SYNOD_UI_USE_TOPOLOGY ?? "true").toLowerCase() === "true";

export const EXPLORER_BASE =
  process.env.SYNOD_UI_EXPLORER_BASE ??
  "https://gensyn-mainnet.explorer.alchemy.com";
