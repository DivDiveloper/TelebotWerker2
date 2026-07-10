// index.ts - Unified async Telegram bot worker (Multi-LLM + Web Search Plugin + Inline Model Menu + Balance + Dynamic Model Cache)
//
// ==========================================
// Lean-up pass (this revision):
// 1. Removed all debug console.log noise introduced during MCP debugging -
//    only console.error remains, and only on genuine failure paths.
// 2. Consolidated per-chat KV state: net-mode + provider + model used to be
//    3 separate keys (3 reads per message). Now a single `settings:{chatId}`
//    key holds all three as one JSON blob -> 1 read instead of 3 on the hot
//    path (every incoming message). Free-plan KV/subrequest budget is finite
//    per request, so fewer round trips matters as much as CPU time does.
// 3. Removed ~150 lines of dead legacy scaffold classes (AzureConfig,
//    WorkersConfig, MistralConfig, AnthropicConfig, DeepSeekConfig,
//    GroqConfig, XAIConfig, DallEConfig, DefineKeys, AgentShareConfig,
//    and the OpenAIConfig/GeminiConfig/CohereConfig/EnvironmentConfig
//    wrapper classes) that were never actually read anywhere except for a
//    couple of constant fields. Replaced with plain module-level consts,
//    which are allocated once at module load instead of once per request -
//    a real (if small) CPU saving on the hot path, and far less noise to
//    read through.
// 4. Dynamic per-provider model list: fetched from each provider's API,
//    filtered to chat-capable models only, cached in a single shared KV
//    key (`models_cache`). Refreshed only on explicit /updatemodels command
//    or on the optional scheduled() Cron Trigger - never on the per-message
//    hot path, so it adds zero background load to normal chat traffic.
// ==========================================

type KVNamespace = any;
type Fetcher = any;

const CONFIG = {
  SEARCH_TIMEOUT_MS: 20000,
  MAX_HISTORY_LENGTH: 8,
  HISTORY_TTL_SECONDS: 86400,
  DEFAULT_SYSTEM_PROMPT: "You are a helpful and professional assistant.",
  SEARCH_TOOL_URL: "http://searchworker/tools/tavily-search",
  KEYS_URL: "http://searchworker/api/keys",
  DEFAULT_SEARCH_DEPTH: "basic",
  DEFAULT_MAX_RESULTS: 5,
  SETTINGS_KEY_PREFIX: "settings:",
  HISTORY_KEY_PREFIX: "history_",
  MODELS_CACHE_KEY: "models_cache",
  MODELS_PER_PROVIDER_CAP: 10,
  MODEL_FETCH_TIMEOUT_MS: 10000,
} as const;

export interface Env {
  DATABASE: KVNamespace;
  SEARCH_SERVICE?: Fetcher;
  TELEGRAM_BOT_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  COHERE_API_KEY?: string;
  TAVILY_PROXY_AUTH_KEY?: string;
  AI_PROVIDER?: string;
}

interface HistoryMessage {
  role: "user" | "assistant" | "model" | "system";
  content: string;
}

interface TelegramPayload {
  chat_id: number;
  text: string;
  parse_mode?: string;
  reply_markup?: any;
  message_id?: number;
}

interface ToolResponse {
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
  error?: string;
}

interface ChatSettings {
  provider: string;
  model: string;
  netOn: boolean;
}

interface ModelsCache {
  gemini?: string[];
  openai?: string[];
  cohere?: string[];
  updatedAt?: number;
}

// ---------------------------------------------------------------------------
// Static provider metadata + fallback model lists. These are the defaults
// used until /updatemodels (or the Cron Trigger) populates the live KV
// cache. They are also the safety net if a live fetch ever fails.
// ---------------------------------------------------------------------------
const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Google Gemini 🤖",
  openai: "OpenAI ⚡",
  cohere: "Cohere 🔮",
};

const PROVIDER_DEFAULTS = {
  gemini: { apiBase: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.5-flash" },
  openai: { apiBase: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  cohere: { apiBase: "https://api.cohere.com/v2", defaultModel: "command-r-plus" },
} as const;

const FALLBACK_MODELS: Record<string, string[]> = {
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-flash-latest"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"],
  cohere: ["command-r-plus", "command-r", "command-r-08-2024"],
};

// =============================================================================
// Telegram helpers
// =============================================================================
async function sendTelegramMessage(chatId: number, text: string, token: string, replyMarkup?: any): Promise<any> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload: TelegramPayload = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: any = await response.json();

  if (!data.ok && data.description?.includes("can't find end of")) {
    delete payload.parse_mode;
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    data = await response.json();
  }
  return data;
}

async function editTelegramMessage(chatId: number, messageId: number, text: string, token: string, replyMarkup?: any): Promise<any> {
  const url = `https://api.telegram.org/bot${token}/editMessageText`;
  const payload: TelegramPayload = { chat_id: chatId, message_id: messageId, text, parse_mode: "Markdown" };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: any = await response.json();

  if (!data.ok && data.description?.includes("can't find end of")) {
    delete payload.parse_mode;
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    data = await response.json();
  }
  return data;
}

function chunkButtons(buttons: any[], chunkSize: number = 2): any[][] {
  const result: any[][] = [];
  for (let i = 0; i < buttons.length; i += chunkSize) {
    result.push(buttons.slice(i, i + chunkSize));
  }
  return result;
}

// =============================================================================
// Chat settings (KV) - consolidated single key per chat.
// One read on the hot path (every message) instead of three.
// =============================================================================
async function getSettings(env: Env, chatId: number): Promise<ChatSettings> {
  const raw = await env.DATABASE.get(`${CONFIG.SETTINGS_KEY_PREFIX}${chatId}`);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through to defaults on corrupt data
    }
  }
  const globalProvider = (env.AI_PROVIDER || "gemini").toLowerCase();
  const provider = globalProvider === "auto" ? "gemini" : globalProvider;
  const model = PROVIDER_DEFAULTS[provider as keyof typeof PROVIDER_DEFAULTS]?.defaultModel || PROVIDER_DEFAULTS.gemini.defaultModel;
  return { provider, model, netOn: false };
}

async function updateSettings(env: Env, chatId: number, patch: Partial<ChatSettings>): Promise<ChatSettings> {
  const current = await getSettings(env, chatId);
  const updated: ChatSettings = { ...current, ...patch };
  await env.DATABASE.put(`${CONFIG.SETTINGS_KEY_PREFIX}${chatId}`, JSON.stringify(updated));
  return updated;
}

// =============================================================================
// Dynamic model list cache (shared across all chats, single KV key)
// =============================================================================
async function getProviderModels(env: Env): Promise<Record<string, string[]>> {
  const raw = await env.DATABASE.get(CONFIG.MODELS_CACHE_KEY);
  let cache: ModelsCache = {};
  if (raw) {
    try {
      cache = JSON.parse(raw);
    } catch {
      // ignore corrupt cache, fall back to defaults below
    }
  }
  return {
    gemini: cache.gemini?.length ? cache.gemini : FALLBACK_MODELS.gemini,
    openai: cache.openai?.length ? cache.openai : FALLBACK_MODELS.openai,
    cohere: cache.cohere?.length ? cache.cohere : FALLBACK_MODELS.cohere,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchOpenAIModels(apiKey: string): Promise<string[]> {
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/models",
    { headers: { Authorization: `Bearer ${apiKey}` } },
    CONFIG.MODEL_FETCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`OpenAI models fetch failed: ${res.status}`);
  const data: any = await res.json();
  const list = (data.data || []) as Array<{ id: string; created?: number }>;
  return list
    .filter((m) => m.id.includes("gpt") && !m.id.includes(":") && !/audio|realtime|transcribe|tts|search/i.test(m.id))
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .slice(0, CONFIG.MODELS_PER_PROVIDER_CAP)
    .map((m) => m.id);
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    {},
    CONFIG.MODEL_FETCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`Gemini models fetch failed: ${res.status}`);
  const data: any = await res.json();
  const list = (data.models || []) as Array<{ name: string; supportedGenerationMethods?: string[] }>;
  return list
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && !m.name.includes("embedding"))
    .slice(0, CONFIG.MODELS_PER_PROVIDER_CAP)
    .map((m) => m.name.replace("models/", ""));
}

async function fetchCohereModels(apiKey: string): Promise<string[]> {
  const res = await fetchWithTimeout(
    "https://api.cohere.com/v1/models",
    { headers: { Authorization: `Bearer ${apiKey}` } },
    CONFIG.MODEL_FETCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`Cohere models fetch failed: ${res.status}`);
  const data: any = await res.json();
  const list = (data.models || []) as Array<{ name: string; endpoints?: string[] }>;
  return list
    .filter((m) => !m.endpoints || m.endpoints.includes("chat"))
    .slice(0, CONFIG.MODELS_PER_PROVIDER_CAP)
    .map((m) => m.name);
}

// Fetches only the providers that have a configured key, merges with the
// existing cache (a provider whose fetch fails keeps its last known list
// instead of being wiped), and writes once to KV.
async function updateModelsJob(env: Env): Promise<string> {
  const raw = await env.DATABASE.get(CONFIG.MODELS_CACHE_KEY);
  let cache: ModelsCache = {};
  if (raw) {
    try {
      cache = JSON.parse(raw);
    } catch {
      cache = {};
    }
  }

  const errors: string[] = [];
  let updatedCount = 0;

  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (geminiKey) {
    try {
      cache.gemini = await fetchGeminiModels(geminiKey);
      updatedCount++;
    } catch (e: any) {
      errors.push(`Gemini: ${e.message}`);
    }
  }

  if (env.OPENAI_API_KEY) {
    try {
      cache.openai = await fetchOpenAIModels(env.OPENAI_API_KEY);
      updatedCount++;
    } catch (e: any) {
      errors.push(`OpenAI: ${e.message}`);
    }
  }

  if (env.COHERE_API_KEY) {
    try {
      cache.cohere = await fetchCohereModels(env.COHERE_API_KEY);
      updatedCount++;
    } catch (e: any) {
      errors.push(`Cohere: ${e.message}`);
    }
  }

  if (updatedCount === 0 && errors.length === 0) {
    return "לא נמצאו מפתחות API פעילים לעדכון מודלים.";
  }

  cache.updatedAt = Date.now();
  await env.DATABASE.put(CONFIG.MODELS_CACHE_KEY, JSON.stringify(cache));

  let status = `✅ עודכנו ${updatedCount} ספקים בהצלחה.`;
  if (errors.length) status += `\n⚠️ שגיאות: ${errors.join(" | ")}`;
  return status;
}

// =============================================================================
// Provider menu (inline keyboards) - reads live model cache, falls back to
// static defaults automatically via getProviderModels().
// =============================================================================
async function sendProviderMenu(chatId: number, token: string, env: Env): Promise<void> {
  const buttons: any[] = [];
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) buttons.push({ text: PROVIDER_LABELS.gemini, callback_data: "select_provider:gemini" });
  if (env.OPENAI_API_KEY) buttons.push({ text: PROVIDER_LABELS.openai, callback_data: "select_provider:openai" });
  if (env.COHERE_API_KEY) buttons.push({ text: PROVIDER_LABELS.cohere, callback_data: "select_provider:cohere" });

  if (buttons.length === 0) {
    for (const key of Object.keys(PROVIDER_LABELS)) {
      buttons.push({ text: PROVIDER_LABELS[key], callback_data: `select_provider:${key}` });
    }
  }

  const keyboard = { inline_keyboard: chunkButtons(buttons, 2) };
  await sendTelegramMessage(
    chatId,
    "⚙️ **תפריט הגדרות מודל**\nבחר ספק בינה מלאכותית מתוך הרשימה הבאה על מנת להציג את המודלים הזמינים שלו:",
    token,
    keyboard
  );
}

// =============================================================================
// Web search plugin - calls the lean internal /tools/tavily-search endpoint.
// No MCP envelope, no SSE, no handshake - see searchworker's own comments.
// =============================================================================
async function fetchWebSearch(query: string, env: Env): Promise<string> {
  const searchService = env.SEARCH_SERVICE;
  if (!searchService) {
    return "שגיאה פנימית: שירות החיפוש אינו מחובר (Service Binding חסר).";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.SEARCH_TIMEOUT_MS);

  try {
    // חייב להשתמש ב-searchService.fetch (ה-Service Binding עצמו), לא ב-fetch()
    // הגלובלי - אחרת הבקשה יוצאת לאינטרנט האמיתי במקום להיות מנותבת פנימית
    // ישירות לוורקר השני, ונתקלת בשגיאת Cloudflare edge (403 / error 1003).
    const response = await searchService.fetch(CONFIG.SEARCH_TOOL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.TAVILY_PROXY_AUTH_KEY || "" },
      body: JSON.stringify({
        query,
        search_depth: CONFIG.DEFAULT_SEARCH_DEPTH,
        max_results: CONFIG.DEFAULT_MAX_RESULTS,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`[fetchWebSearch] HTTP ${response.status}: ${errBody.slice(0, 300)}`);
      return `שגיאה בפנייה לשרת החיפוש: ${response.status}`;
    }

    const payload: ToolResponse = await response.json();
    const textResult = payload.content?.[0]?.text;

    if (payload.isError) {
      console.error("[fetchWebSearch] Tool error:", textResult || payload.error);
      return `שגיאת כלי חיפוש: ${textResult || payload.error || "unknown error"}`;
    }

    return textResult || "לא נמצאו תוצאות חיפוש רלוונטיות.";
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error?.name === "AbortError") {
      return "שגיאה: החיפוש נמשך יותר מדי זמן וננטש (timeout).";
    }
    console.error("[fetchWebSearch] Exception:", error);
    return `שגיאת מערכת חריגה: ${error?.message || error}`;
  }
}

// =============================================================================
// LLM providers
// =============================================================================
async function callGemini(systemPrompt: string, history: HistoryMessage[], apiKey: string, model: string): Promise<string> {
  const url = `${PROVIDER_DEFAULTS.gemini.apiBase}/models/${model}:generateContent?key=${apiKey}`;
  const contents = history.map((msg) => ({
    role: msg.role === "assistant" || msg.role === "model" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.7 },
    }),
  });

  if (!response.ok) throw new Error(`Gemini API Error: ${await response.text()}`);
  const data: any = await response.json();
  const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!replyText) throw new Error("לא התקבלה תשובה תקינה מ-Gemini.");
  return replyText;
}

async function callOpenAI(systemPrompt: string, history: HistoryMessage[], apiKey: string, model: string): Promise<string> {
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((msg) => ({ role: msg.role === "assistant" || msg.role === "model" ? "assistant" : "user", content: msg.content })),
  ];

  const response = await fetch(`${PROVIDER_DEFAULTS.openai.apiBase}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
  });

  if (!response.ok) throw new Error(`OpenAI API Error: ${await response.text()}`);
  const data: any = await response.json();
  const replyText = data.choices?.[0]?.message?.content;
  if (!replyText) throw new Error("לא התקבלה תשובה תקינה מ-OpenAI.");
  return replyText;
}

async function callCohere(systemPrompt: string, history: HistoryMessage[], apiKey: string, model: string): Promise<string> {
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((msg) => ({ role: msg.role === "assistant" || msg.role === "model" ? "assistant" : "user", content: msg.content })),
  ];

  const response = await fetch(`${PROVIDER_DEFAULTS.cohere.apiBase}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages }),
  });

  if (!response.ok) throw new Error(`Cohere API Error: ${await response.text()}`);
  const data: any = await response.json();
  let replyText = "";
  if (Array.isArray(data.message?.content)) replyText = data.message.content[0]?.text || "";
  else if (typeof data.message?.content === "string") replyText = data.message.content;
  if (!replyText) throw new Error("לא התקבלה תשובה תקינה מ-Cohere.");
  return replyText;
}

async function callLLM(systemPrompt: string, history: HistoryMessage[], env: Env, provider: string, model: string): Promise<string> {
  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("מפתח API של OpenAI חסר (OPENAI_API_KEY).");
    return callOpenAI(systemPrompt, history, env.OPENAI_API_KEY, model);
  }
  if (provider === "cohere") {
    if (!env.COHERE_API_KEY) throw new Error("מפתח API של Cohere חסר (COHERE_API_KEY).");
    return callCohere(systemPrompt, history, env.COHERE_API_KEY, model);
  }
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!geminiKey) throw new Error("מפתח API של Gemini חסר (GEMINI_API_KEY).");
  return callGemini(systemPrompt, history, geminiKey, model);
}

// =============================================================================
// Background message handler (runs inside ctx.waitUntil - exactly one task
// per incoming message, no parallel background work spawned).
// =============================================================================
async function handleMessageAndReply(chatId: number, text: string, env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN || "";
  if (!token) return;

  try {
    // Single KV read for provider + model + net-search-mode (was 3 reads).
    const settings = await getSettings(env, chatId);

    let searchResults = "";
    let tempMessageId: number | null = null;

    if (settings.netOn) {
      const tempMsg = await sendTelegramMessage(chatId, "🔄 *מחפש מידע עדכני באינטרנט...*", token);
      tempMessageId = tempMsg?.result?.message_id ?? null;
      searchResults = await fetchWebSearch(text, env);
    }

    let history: HistoryMessage[] = [];
    const rawHistory = await env.DATABASE.get(`${CONFIG.HISTORY_KEY_PREFIX}${chatId}`);
    if (rawHistory) {
      try {
        history = JSON.parse(rawHistory);
      } catch {
        history = [];
      }
    }

    history.push({ role: "user", content: text });

    let systemPrompt = CONFIG.DEFAULT_SYSTEM_PROMPT;
    if (settings.netOn && searchResults) {
      systemPrompt += `\n\n[USER SEARCH CONTEXT]\nלהלן מידע עדכני שנמצא ברשת לגבי שאלת המשתמש. השתמש בו כדי לענות בצורה מבוססת ומדויקת:\n\n${searchResults}`;
    }

    let botReply: string;
    try {
      botReply = await callLLM(systemPrompt, history, env, settings.provider, settings.model);
    } catch (error: any) {
      console.error("LLM Call Error:", error);
      botReply = `מצטער, חלה שגיאה בעיבוד התשובה: ${error.message}`;
    }

    history.push({ role: "model", content: botReply });
    if (history.length > CONFIG.MAX_HISTORY_LENGTH) {
      history = history.slice(history.length - CONFIG.MAX_HISTORY_LENGTH);
    }

    await env.DATABASE.put(`${CONFIG.HISTORY_KEY_PREFIX}${chatId}`, JSON.stringify(history), { expirationTtl: CONFIG.HISTORY_TTL_SECONDS });

    if (settings.netOn && tempMessageId) {
      await editTelegramMessage(chatId, tempMessageId, botReply, token);
    } else {
      await sendTelegramMessage(chatId, botReply, token);
    }
  } catch (err) {
    console.error("Error in background task handler:", err);
  }
}

// =============================================================================
// Inline keyboard callback handler
// =============================================================================
async function handleCallbackQuery(callbackQuery: any, env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN || "";
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data || "";

  // Acknowledge immediately to clear the Telegram loading spinner.
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQuery.id }),
  });

  try {
    if (data.startsWith("select_provider:")) {
      const provider = data.split(":")[1];
      const label = PROVIDER_LABELS[provider];
      if (!label) return;

      const modelsByProvider = await getProviderModels(env);
      const models = modelsByProvider[provider] || FALLBACK_MODELS[provider] || [];

      const keyboardRows = models.map((model) => [{ text: `🤖 ${model}`, callback_data: `select_model:${provider}:${model}` }]);
      keyboardRows.push([{ text: "🔙 חזור לספקים", callback_data: "back_to_providers" }]);

      await editTelegramMessage(
        chatId,
        messageId,
        `⚙️ **תפריט דגמי ${label}**\nבחר את דגם המודל המועדף עליך מתוך הרשימה הבאה:`,
        token,
        { inline_keyboard: keyboardRows }
      );
    } else if (data.startsWith("select_model:")) {
      const [, provider, model] = data.split(":");
      await updateSettings(env, chatId, { provider, model });

      const providerName = PROVIDER_LABELS[provider] || provider;
      await editTelegramMessage(
        chatId,
        messageId,
        `✅ **הגדרות המודל עודכנו בהצלחה!**\n\n🤖 ספק מוגדר: **${providerName}**\n🎯 מודל פעיל: \`${model}\`\n\nמעתה, כל הודעות השיחה והחיפושים הבאים שלך ישתמשו במודל זה.`,
        token
      );
    } else if (data === "back_to_providers") {
      await sendProviderMenuInline(chatId, messageId, token, env);
    }
  } catch (error) {
    console.error("Callback Query Error:", error);
  }
}

async function sendProviderMenuInline(chatId: number, messageId: number, token: string, env: Env): Promise<void> {
  const buttons: any[] = [];
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) buttons.push({ text: PROVIDER_LABELS.gemini, callback_data: "select_provider:gemini" });
  if (env.OPENAI_API_KEY) buttons.push({ text: PROVIDER_LABELS.openai, callback_data: "select_provider:openai" });
  if (env.COHERE_API_KEY) buttons.push({ text: PROVIDER_LABELS.cohere, callback_data: "select_provider:cohere" });

  if (buttons.length === 0) {
    for (const key of Object.keys(PROVIDER_LABELS)) {
      buttons.push({ text: PROVIDER_LABELS[key], callback_data: `select_provider:${key}` });
    }
  }

  await editTelegramMessage(
    chatId,
    messageId,
    "⚙️ **תפריט הגדרות מודל**\nבחר ספק בינה מלאכותית מתוך הרשימה הבאה על מנת להציג את המודלים הזמינים שלו:",
    token,
    { inline_keyboard: chunkButtons(buttons, 2) }
  );
}

// =============================================================================
// Worker entry point
// =============================================================================
export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Bot is running!", { status: 200 });
    }

    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return new Response("Error: TELEGRAM_BOT_TOKEN is missing.", { status: 500 });
    }

    try {
      const update: any = await request.json();

      if (update.callback_query) {
        ctx.waitUntil(handleCallbackQuery(update.callback_query, env));
        return new Response("OK", { status: 200 });
      }

      if (update.message?.chat) {
        const chatId = update.message.chat.id;
        const text = (update.message.text || "").trim();

        switch (text) {
          case "/start": {
            const welcomeText =
              "שלום! אני בוט הכל-יכול שלך. 🤖✨\n\n" +
              "פקודות זמינות לשימוש:\n" +
              "⚙️ /models - תפריט בחירה והחלפת מודלים\n" +
              "🔄 /updatemodels - עדכון רשימת המודלים מהספקים\n" +
              "📊 /balance - בדיקת יתרת קרדיטים ב-Tavily API\n" +
              "🔍 /neton - הפעלת מצב חיפוש באינטרנט\n" +
              "💬 /netoff - כיבוי מצב חיפוש וחזרה לשיחה רגילה\n" +
              "🧹 /clear או /reset - איפוס מיידי של היסטוריית השיחה הנוכחית";
            await sendTelegramMessage(chatId, welcomeText, token);
            return new Response("OK", { status: 200 });
          }

          case "/neton": {
            await updateSettings(env, chatId, { netOn: true });
            await sendTelegramMessage(chatId, "🔍 **מצב חיפוש אינטרנט הופעל בהצלחה!**\nהשאילתות הבאות שלך יחופשו ברשת וייענו על בסיס תוצאות עדכניות.", token);
            return new Response("OK", { status: 200 });
          }

          case "/netoff": {
            await updateSettings(env, chatId, { netOn: false });
            await sendTelegramMessage(chatId, "💬 **מצב חיפוש אינטרנט כבוי.**\nחוזר למצב שיחה רגיל מול המודל.", token);
            return new Response("OK", { status: 200 });
          }

          case "/clear":
          case "/reset": {
            await env.DATABASE.delete(`${CONFIG.HISTORY_KEY_PREFIX}${chatId}`);
            await sendTelegramMessage(chatId, "🧹 **היסטוריית השיחה אופסה בהצלחה.**", token);
            return new Response("OK", { status: 200 });
          }

          case "/models": {
            await sendProviderMenu(chatId, token, env);
            return new Response("OK", { status: 200 });
          }

          case "/updatemodels": {
            // Runs inline (not via waitUntil) since the user is waiting for
            // a direct status reply; it's an explicit, infrequent command,
            // not hot-path traffic.
            const status = await updateModelsJob(env);
            await sendTelegramMessage(chatId, `🔄 **עדכון רשימת מודלים**\n\n${status}`, token);
            return new Response("OK", { status: 200 });
          }

          case "/balance": {
            const searchService = env.SEARCH_SERVICE;
            if (!searchService) {
              await sendTelegramMessage(chatId, "⚠️ **שגיאה:** שירות החיפוש (`SEARCH_SERVICE`) אינו מחובר לבוט הראשי.", token);
              return new Response("OK", { status: 200 });
            }
            const res = await searchService.fetch(CONFIG.KEYS_URL, { headers: { "x-api-key": env.TAVILY_PROXY_AUTH_KEY || "" } });
            if (!res.ok) {
              await sendTelegramMessage(chatId, `⚠️ **שגיאה מה-Proxy של החיפושים:** סטטוס \`${res.status}\``, token);
              return new Response("OK", { status: 200 });
            }
            const data: any = await res.json();
            const keys = data.keys;
            if (!Array.isArray(keys)) {
              await sendTelegramMessage(chatId, "⚠️ **שגיאה:** ה-Proxy החזיר נתון שאינו תואם למבנה הנדרש.", token);
              return new Response("OK", { status: 200 });
            }
            const msg = `📊 **Tavily Credits:**\n` + keys.map((k: any) => `🔑 \`${k.apiKey.slice(0, 8)}...${k.apiKey.slice(-4)}\`: *${(k.remainingCredit || 0).toLocaleString()}*`).join("\n");
            await sendTelegramMessage(chatId, msg, token);
            return new Response("OK", { status: 200 });
          }

          default: {
            if (!text) return new Response("OK", { status: 200 });
            ctx.waitUntil(handleMessageAndReply(chatId, text, env));
            return new Response("OK", { status: 200 });
          }
        }
      }
    } catch (err) {
      console.error("Worker Global Error:", err);
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  },

  // Optional Cron Trigger handler for fully automatic model-list refresh.
  // Add to wrangler.toml to enable, e.g.:
  //   [triggers]
  //   crons = ["0 3 * * *"]   # daily at 03:00 UTC
  // This runs as its own isolated invocation - it never touches the
  // per-message hot path or its CPU/subrequest budget.
  async scheduled(_event: any, env: Env, ctx: any): Promise<void> {
    ctx.waitUntil(updateModelsJob(env));
  },
};
