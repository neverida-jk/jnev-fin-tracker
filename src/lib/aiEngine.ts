// Optional, fully-degradable AI narrative layer. Nothing in this app ever
// *depends* on this module — every caller supplies a deterministic
// `fallbackText` (built from real numbers by the template functions in
// financialContext.ts / monthInReview.ts) and generateNarrative() guarantees
// that text is returned whenever AI isn't available, isn't enabled, or
// fails for any reason. This module never invents financial figures itself;
// it only ever rephrases/expands facts the caller already computed.
//
// Three tiers, in order of preference:
//   1. "native"      — the browser's built-in on-device model (Chrome's
//                       experimental Prompt API / Gemini Nano). Zero
//                       download by this app; whatever the browser already
//                       ships/manages.
//   2. "local-model"  — a small model downloaded once (opt-in) and run
//                       fully in-browser via @xenova/transformers (WASM).
//   3. "template"    — the deterministic fallback text the caller passed in.

export type AiTier = 'native' | 'local-model' | 'template'

// localStorage key backing the user's opt-in preference for downloading and
// running the in-browser local model. Default is false/opt-in-only: unlike
// the native tier (managed by the browser) and the template tier (always
// local, zero network), this is a real multi-hundred-MB download the first
// time it runs, so the user must explicitly turn it on.
const LOCAL_MODEL_STORAGE_KEY = 'ai-local-model-enabled'

/** Feature-detects a browser built-in on-device language model. This is an
 * experimental, fast-moving browser API (Chrome's "Prompt API" / Gemini
 * Nano) that has gone through a few different global shapes as it evolved
 * through Chrome's origin-trial process, so we defensively check more than
 * one. Every check is wrapped in try/catch — these APIs may be entirely
 * undefined, may exist but be gated behind a disabled experimental flag (and
 * throw on access), or may reject with "not available" for reasons outside
 * our control (e.g. no download-plan, on a device too small to run it).
 * None of that should ever crash the app; any failure just means "no native
 * AI", handled the same as it not existing at all. */
export async function detectNativeAi(): Promise<boolean> {
  const g = globalThis as Record<string, unknown>

  try {
    // Shape 1 — current Chrome Prompt API surface: a global `LanguageModel`
    // object with `.availability()` (returns 'available' | 'downloadable' |
    // 'downloading' | 'unavailable') and `.create()`.
    const languageModel = g.LanguageModel as
      | { availability?: () => Promise<string>; create?: (...args: unknown[]) => unknown }
      | undefined
    if (languageModel) {
      if (typeof languageModel.availability === 'function') {
        const availability = await languageModel.availability()
        return availability === 'available' || availability === 'downloadable' || availability === 'downloading'
      }
      if (typeof languageModel.create === 'function') return true
    }
  } catch {
    // fall through and try the other historical shape
  }

  try {
    // Shape 2 — earlier `window.ai` / `self.ai` root object, exposing either
    // `.languageModel` (early Prompt API naming) or `.assistant` (an even
    // earlier naming used during Chrome's origin trial), each with either
    // `.availability()` (newer) or `.capabilities()` returning
    // `{ available: 'readily' | 'after-download' | 'no' }` (older).
    const aiRoot = (g.ai ?? (g.self as Record<string, unknown> | undefined)?.ai ?? (g.window as Record<string, unknown> | undefined)?.ai) as
      | Record<string, unknown>
      | undefined
    const factory = (aiRoot?.languageModel ?? aiRoot?.assistant) as
      | {
          availability?: () => Promise<string>
          capabilities?: () => Promise<{ available?: string }>
          create?: (...args: unknown[]) => unknown
        }
      | undefined

    if (factory) {
      if (typeof factory.availability === 'function') {
        const availability = await factory.availability()
        return availability === 'available' || availability === 'downloadable' || availability === 'downloading'
      }
      if (typeof factory.capabilities === 'function') {
        const caps = await factory.capabilities()
        return caps?.available === 'readily' || caps?.available === 'after-download'
      }
      if (typeof factory.create === 'function') return true
    }
  } catch {
    // experimental API — may throw when the underlying flag is disabled
  }

  return false
}

/** Actually runs a prompt against whichever native AI shape detectNativeAi()
 * found. Kept separate from detection so a session-creation/prompt failure
 * (e.g. the user declines an in-browser download prompt, or the model is
 * mid-download) can't crash detection for future calls — callers should
 * treat any rejection here the same as "native AI not available". */
async function promptNativeAi(prompt: string): Promise<string> {
  const g = globalThis as Record<string, unknown>

  const languageModel = g.LanguageModel as { create?: (...args: unknown[]) => Promise<{ prompt: (p: string) => Promise<string> }> } | undefined
  if (languageModel && typeof languageModel.create === 'function') {
    const session = await languageModel.create()
    return String(await session.prompt(prompt))
  }

  const aiRoot = (g.ai ?? (g.self as Record<string, unknown> | undefined)?.ai ?? (g.window as Record<string, unknown> | undefined)?.ai) as
    | Record<string, unknown>
    | undefined
  const factory = (aiRoot?.languageModel ?? aiRoot?.assistant) as
    | { create?: (...args: unknown[]) => Promise<{ prompt: (p: string) => Promise<string> }> }
    | undefined
  if (factory && typeof factory.create === 'function') {
    const session = await factory.create()
    return String(await session.prompt(prompt))
  }

  throw new Error('No native AI session available')
}

/** Whether the user has opted in to downloading and running the in-browser
 * local model. Defaults to false (opt-in only) — see LOCAL_MODEL_STORAGE_KEY
 * above for why. Wrapped in try/catch since localStorage can throw in some
 * contexts (e.g. private browsing with storage disabled). */
export function isLocalModelEnabled(): boolean {
  try {
    return localStorage.getItem(LOCAL_MODEL_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setLocalModelEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LOCAL_MODEL_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // localStorage unavailable — the preference just doesn't persist, and
    // isLocalModelEnabled() safely defaults back to false either way.
  }
}

/** Runs a prompt through a small local model entirely in-browser, via
 * @xenova/transformers (transformers.js). Only ever called when
 * isLocalModelEnabled() is true, since the first call triggers a real
 * network download of the model weights (cached by the browser after that —
 * every call after the first is fully offline).
 *
 * `@xenova/transformers` is intentionally imported dynamically (never as a
 * static/top-level import anywhere in the app) so it — and the WASM/ONNX
 * runtime it pulls in — never ends up in the main bundle, consistent with
 * this app's existing route-level code-splitting. It's only fetched the
 * first time this function actually runs.
 *
 * Model choice: "Xenova/LaMini-Flan-T5-248M" — a 248M-parameter
 * instruction-tuned sequence-to-sequence model (LaMini-LM, fine-tuned from
 * Flan-T5-base), pre-converted to ONNX and quantized by the transformers.js
 * team. The quantized weights are roughly 150-300MB depending on which
 * variant the pipeline selects (well within the "few hundred MB or less"
 * budget), run through WASM with no GPU required, and it's small/fast
 * enough for a short instruct-style rewrite like this one. It's not the
 * most fluent model available, but that's an acceptable trade-off here
 * since composeLocalAnswer-style deterministic text is always the
 * guaranteed fallback if this tier is unavailable or produces something
 * unusable. */
export async function generateWithLocalModel(prompt: string): Promise<string> {
  if (!isLocalModelEnabled()) {
    throw new Error('Local model is not enabled — call setLocalModelEnabled(true) first.')
  }

  const { pipeline } = await import('@xenova/transformers')
  const generator = await pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-248M')
  const output = await generator(prompt, { max_new_tokens: 120 })

  const first = Array.isArray(output) ? output[0] : output
  const text = (first as { generated_text?: string } | undefined)?.generated_text
  if (!text || !text.trim()) throw new Error('Local model returned no usable text')
  return text.trim()
}

/** The single entry point callers should use. Tries native AI first (if
 * detectNativeAi() resolves true), then the opt-in local model, and always
 * falls back to the caller-supplied `fallbackText` if either path is
 * unavailable or throws for any reason — this function can never leave the
 * caller with nothing to show, and never fabricates data of its own; it
 * only ever rephrases/expands the facts already baked into `prompt` /
 * `fallbackText` by the caller. */
export async function generateNarrative(prompt: string, fallbackText: string): Promise<{ text: string; tier: AiTier }> {
  try {
    if (await detectNativeAi()) {
      const text = await promptNativeAi(prompt)
      if (text.trim()) return { text: text.trim(), tier: 'native' }
    }
  } catch {
    // native AI unavailable or failed — fall through to the next tier
  }

  try {
    if (isLocalModelEnabled()) {
      const text = await generateWithLocalModel(prompt)
      if (text.trim()) return { text: text.trim(), tier: 'local-model' }
    }
  } catch {
    // local model unavailable, not yet downloaded, or failed — fall through
  }

  return { text: fallbackText, tier: 'template' }
}
