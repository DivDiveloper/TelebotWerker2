// index.ts - קובץ מאוחד, אסינכרוני ומאובטח לבוט הטלגרם (Multi-LLM + Web Search Proxy + Inline Keyboards /models + בדיקת יתרה /balance + cohere v2 llm)
//
// ==========================================
// עדכוני תיקון (MCP fixes):
// 1. שם הכלי תוקן מ-"tavily_search" ל-"tavily-search" (התאמה מדויקת לשם הרשום בשרת ה-MCP).
// 2. ה-Accept header בקריאה ל-/mcp כולל כעת "application/json, text/event-stream" יחד,
//    כפי שדורש StreamableHTTPServerTransport - אחרת השרת מחזיר 400 לפני שמגיע ל-handler.
// 3. fetchWebSearch תומך גם בתשובת JSON רגילה וגם בתשובת SSE (data: ...), בהתאם ל-content-type.
// 4. נוסף AbortController עם timeout של 20 שניות כדי למנוע תקיעה שקטה ("מחפש מידע..." בלי מענה).
// 5. טיפול שגיאות מורחב לאורך כל fetchWebSearch כדי שהמשתמש תמיד יקבל הודעה ברורה.
// ==========================================

// פתרון שגיאות קומפילציה של TypeScript עבור סביבות ללא הגדרות גלובליות של Cloudflare
type KVNamespace = any;
type Fetcher = any;

// ==========================================
// 1. הגדרות טיפוסים (Types & Interfaces)
// ==========================================
export interface Env {
  DATABASE: KVNamespace;
  SEARCH_SERVICE?: Fetcher; // Service Binding לוורקר החיפוש

  // משתני סביבה ראשיים
  TELEGRAM_BOT_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  COHERE_API_KEY?: string; // מפתח האבטחה עבור Cohere
  TAVILY_PROXY_AUTH_KEY?: string;
  AI_PROVIDER?: string;
}

// mcp-proxy - מפת המודלים הנתמכים בתפריט המובנה
const PROVIDERS: any = {
  gemini: {
    name: "Google Gemini 🤖",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-flash-latest"]
  },
  openai: {
    name: "OpenAI ⚡",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"]
  },
  cohere: {
    name: "Cohere 🔮",
    models: ["command-r-plus", "command-r", "command-r-08-2024"]
  }
};

// ==========================================
// 2. מחלקות ההגדרה המקוריות של הפרויקט
// ==========================================
class AgentShareConfig {
  AI_PROVIDER = "auto";
  AI_IMAGE_PROVIDER = "auto";
  SYSTEM_INIT_MESSAGE = null;
}

class OpenAIConfig {
  OPENAI_API_KEY: any[] = [];
  OPENAI_CHAT_MODEL = "gpt-4o-mini";
  OPENAI_API_BASE = "https://api.openai.com/v1";
  OPENAI_API_EXTRA_PARAMS = {};
  OPENAI_CHAT_MODELS_LIST = "";
}

class DallEConfig {
  DALL_E_MODEL = "dall-e-3";
  DALL_E_IMAGE_SIZE = "1024x1024";
  DALL_E_IMAGE_QUALITY = "standard";
  DALL_E_IMAGE_STYLE = "vivid";
  DALL_E_MODELS_LIST = '["dall-e-3"]';
}

class AzureConfig {
  AZURE_API_KEY = null;
  AZURE_RESOURCE_NAME = null;
  AZURE_CHAT_MODEL = "gpt-4o-mini";
  AZURE_IMAGE_MODEL = "dall-e-3";
  AZURE_API_VERSION = "2024-06-01";
  AZURE_CHAT_MODELS_LIST = "";
  AZURE_CHAT_EXTRA_PARAMS = {};
}

class WorkersConfig {
  CLOUDFLARE_ACCOUNT_ID = null;
  CLOUDFLARE_TOKEN = null;
  WORKERS_CHAT_MODEL = "@cf/qwen/qwen1.5-7b-chat-awq";
  WORKERS_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
  WORKERS_CHAT_MODELS_LIST = "";
  WORKERS_IMAGE_MODELS_LIST = "";
  WORKERS_CHAT_EXTRA_PARAMS = {};
}

class GeminiConfig {
  GOOGLE_API_KEY = null;
  GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
  GOOGLE_CHAT_MODEL = "gemini-2.5-flash"; // מודל ברירת מחדל עדכני ותקין
  GOOGLE_CHAT_MODELS_LIST = "";
  GOOGLE_CHAT_EXTRA_PARAMS = {};
}

class MistralConfig {
  MISTRAL_API_KEY = null;
  MISTRAL_API_BASE = "https://api.mistral.ai/v1";
  MISTRAL_CHAT_MODEL = "mistral-tiny";
  MISTRAL_CHAT_MODELS_LIST = "";
  MISTRAL_CHAT_EXTRA_PARAMS = {};
}

class CohereConfig {
  COHERE_API_KEY = null;
  COHERE_API_BASE = "https://api.cohere.com/v2";
  COHERE_CHAT_MODEL = "command-r-plus";
  COHERE_CHAT_MODELS_LIST = "";
  COHERE_CHAT_EXTRA_PARAMS = {};
}

class AnthropicConfig {
  ANTHROPIC_API_KEY = null;
  ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
  ANTHROPIC_CHAT_MODEL = "claude-3-5-haiku-latest";
  ANTHROPIC_CHAT_MODELS_LIST = "";
  ANTHROPIC_CHAT_EXTRA_PARAMS = {};
}

class DeepSeekConfig {
  DEEPSEEK_API_KEY = null;
  DEEPSEEK_API_BASE = "https://api.deepseek.com";
  DEEPSEEK_CHAT_MODEL = "deepseek-chat";
  DEEPSEEK_CHAT_MODELS_LIST = "";
  DEEPSEEK_CHAT_EXTRA_PARAMS = {};
}

class GroqConfig {
  GROQ_API_KEY = null;
  GROQ_API_BASE = "https://api.groq.com/openai/v1";
  GROQ_CHAT_MODEL = "groq-chat";
  GROQ_CHAT_MODELS_LIST = ""; // תוקן לאותיות גדולות למניעת בעיות זיהוי
  GROQ_CHAT_EXTRA_PARAMS = {};
}

class XAIConfig {
  XAI_API_KEY = null;
  XAI_API_BASE = "https://api.x.ai/v1";
  XAI_CHAT_MODEL = "grok-2-latest";
  XAI_CHAT_MODELS_LIST = "";
  XAI_CHAT_EXTRA_PARAMS = {};
}

class DefineKeys {
  DEFINE_KEYS: any[] = [];
}

class EnvironmentConfig {
  LANGUAGE = "he"; // עברית כברירת מחדל
  UPDATE_BRANCH = "master";
  CHAT_COMPLETE_API_TIMEOUT = 0;
  TELEGRAM_API_DOMAIN = "https://api.telegram.org";
  TELEGRAM_AVAILABLE_TOKENS: any[] = [];
  DEFAULT_PARSE_MODE = "Markdown";
  TELEGRAM_MIN_STREAM_INTERVAL = 0;
  TELEGRAM_PHOTO_SIZE_OFFSET = 1;
  TELEGRAM_IMAGE_TRANSFER_MODE = "base64";
  MODEL_LIST_COLUMNS = 1;
  I_AM_A_GENEROUS_PERSON = false;
  CHAT_WHITE_LIST: any[] = [];
  LOCK_USER_CONFIG_KEYS = [
    "OPENAI_API_BASE",
    "GOOGLE_API_BASE",
    "MISTRAL_API_BASE",
    "COHERE_API_BASE",
    "ANTHROPIC_API_BASE",
    "DEEPSEEK_API_BASE",
    "GROQ_API_BASE",
    "XAI_API_BASE"
  ];
  TELEGRAM_BOT_NAME: any[] = [];
  CHAT_GROUP_WHITE_LIST: any[] = [];
  GROUP_CHAT_BOT_ENABLE = true;
  GROUP_CHAT_BOT_SHARE_MODE = true;
  AUTO_TRIM_HISTORY = true;
  MAX_HISTORY_LENGTH = 8; // מגבלת זיכרון יעילה
  MAX_TOKEN_LENGTH = -1;
  HISTORY_IMAGE_PLACEHOLDER = null;
  HIDE_COMMAND_BUTTONS: any[] = [];
  SHOW_REPLY_BUTTON = false;
  EXTRA_MESSAGE_CONTEXT = false;
  EXTRA_MESSAGE_MEDIA_COMPATIBLE = ["image"];
  STREAM_MODE = false;
  SAFE_MODE = true;
  DEBUG_MODE = false;
  DEV_MODE = false;

  // הגדרות מצב החיפוש
  DEFAULT_NET_MODE = false;
  NET_MODE_KEY_PREFIX = "net_mode_";
}

// ==========================================
// 3. פונקציות עזר של טלגרם (תמיכה בכפתורי Inline ומנגנון Fallback)
// ==========================================
async function sendTelegramMessage(chatId: number, text: string, token: string, replyMarkup?: any): Promise<any> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload: any = {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown",
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data: any = await response.json();

  if (!data.ok && data.description && data.description.includes("can't find end of")) {
    console.warn("Telegram Markdown parsing failed, falling back to plain text.");
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
  const payload: any = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: "Markdown",
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data: any = await response.json();

  if (!data.ok && data.description && data.description.includes("can't find end of")) {
    console.warn("Telegram edit Markdown parsing failed, falling back to plain text.");
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

// פונקציית עזר לחלוקת כפתורים לשורות של עד 2 כפתורים בשורה
function chunkButtons(buttons: any[], chunkSize: number = 2): any[][] {
  const result: any[][] = [];
  for (let i = 0; i < buttons.length; i += chunkSize) {
    result.push(buttons.slice(i, i + chunkSize));
  }
  return result;
}

// תפריט הבית לבחירת ספק מודלים - מסונן דינמית לפי המפתחות הקיימים בסודות
async function sendProviderMenu(chatId: number, token: string, env: Env): Promise<void> {
  const buttons: any[] = [];

  const hasGemini = !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  const hasOpenAI = !!env.OPENAI_API_KEY;
  const hasCohere = !!env.COHERE_API_KEY;

  if (hasGemini) {
    buttons.push({ text: "Google Gemini 🤖", callback_data: "select_provider:gemini" });
  }
  if (hasOpenAI) {
    buttons.push({ text: "OpenAI ⚡", callback_data: "select_provider:openai" });
  }
  if (hasCohere) {
    buttons.push({ text: "Cohere 🔮", callback_data: "select_provider:cohere" });
  }

  // במידה ולא הוגדר אף מפתח, נציג את כולם כברירת מחדל כדי למנוע תפריט ריק
  if (buttons.length === 0) {
    buttons.push({ text: "Google Gemini 🤖", callback_data: "select_provider:gemini" });
    buttons.push({ text: "OpenAI ⚡", callback_data: "select_provider:openai" });
    buttons.push({ text: "Cohere 🔮", callback_data: "select_provider:cohere" });
  }

  const keyboard = {
    inline_keyboard: chunkButtons(buttons, 2) // עימוד חכם של 2 כפתורים בשורה
  };

  await sendTelegramMessage(
    chatId,
    "⚙️ **תפריט הגדרות מודל**\nבחר ספק בינה מלאכותית מתוך הרשימה הבאה על מנת להציג את המודלים הזמינים שלו:",
    token,
    keyboard
  );
}

// ==========================================
// 4. פנייה לוורקר החיפוש (MCP) - עם תמיכה ב-JSON וב-SSE + Timeout
// ==========================================
async function fetchWebSearch(query, env) {
  const searchService = env.SEARCH_SERVICE;
  if (!searchService) {
    console.error("SEARCH_SERVICE binding is missing in environment.");
    return "שגיאה פנימית: שירות החיפוש אינו מחובר (Service Binding חסר).";
  }

  const authKey = env.TAVILY_PROXY_AUTH_KEY || "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 שניות מקסימום

  try {
    // יצירת מזהה בקשה דינמי כדי למנוע התנגשויות (ID Collision) בשרת
    const requestId = Math.floor(Math.random() * 1000000);

    const response = await searchService.fetch("http://searchworker/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "x-api-key": authKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "tavily_search", // תיקון: קו תחתון (_) במקום מקף (-) בהתאם לריפו
          arguments: {
            query: query,
            search_depth: "basic", // הוספת ארגומנט חובה/מומלץ לפרוקסי
            max_results: 5
          }
        },
        id: requestId
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // קריאת התשובה הגולמית מהשרת
    const rawText = await response.text();

    // ==========================================
    // לוג זמני לדיבאג (ניתן להסרה לאחר שהחיפוש עובד)
    // לוג זה ידפיס לטרמינל/לקונסול של Cloudflare את התשובה המדויקת של השרת
    console.log(`[DEBUG] Search Response Status: ${response.status}`);
    console.log(`[DEBUG] Search Response Raw Body: ${rawText}`);
    // ==========================================

    if (!response.ok) {
      console.error(`[fetchWebSearch] HTTP ${response.status}: ${rawText.slice(0, 500)}`);
      return `שגיאה בפנייה לשרת החיפוש: ${response.status} - ${rawText.slice(0, 500)}`;
    }

    const contentType = response.headers.get("content-type") || "";
    let jsonPayload = null;

    if (contentType.includes("application/json")) {
      try {
        jsonPayload = JSON.parse(rawText);
      } catch (e) {
        return `שגיאה: לא ניתן לפענח תשובת JSON מהשרת: ${rawText.slice(0, 300)}`;
      }
    } else if (contentType.includes("text/event-stream")) {
      const lines = rawText.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === "[DONE]") continue;
          try {
            jsonPayload = JSON.parse(dataStr);
          } catch (_) {
            // התעלמות משורות חלקיות
          }
        }
      }
    } else {
      try {
        jsonPayload = JSON.parse(rawText);
      } catch {
        console.error(`[fetchWebSearch] Unexpected content-type "${contentType}": ${rawText.slice(0, 300)}`);
        return `שגיאה: תשובה לא צפויה מהשרת (content-type: ${contentType}).`;
      }
    }

    if (!jsonPayload) {
      return "שגיאה: לא הצלחתי לחלץ נתונים מתשובת שרת החיפוש.";
    }

    if (jsonPayload.error) {
      console.error("[fetchWebSearch] MCP error:", jsonPayload.error);
      return `שגיאת MCP: ${jsonPayload.error.message || JSON.stringify(jsonPayload.error)}`;
    }

    // חילוץ התוכן מתוך מבנה ה-MCP הסטנדרטי
    const textResult = jsonPayload.result?.content?.[0]?.text;

    if (jsonPayload.result?.isError) {
      return `שגיאת כלי חיפוש: ${textResult || "unknown error"}`;
    }

    return textResult || "לא נמצאו תוצאות חיפוש רלוונטיות.";
  } catch (error) {
    clearTimeout(timeoutId);
    if (error?.name === "AbortError") {
      console.error("[fetchWebSearch] Timeout after 20s");
      return "שגיאה: החיפוש נמשך יותר מדי זמן וננטש (timeout).";
    }
    console.error("Search failed:", error);
    return `שגיאת מערכת חריגה: ${error?.message || error}`;
  }
}

// ==========================================
// 5. קריאות ל-APIs של ה-LLMs (עם תמיכה במודל דינמי)
// ==========================================

// קריאה ל-Gemini API עם תמיכה במודל שנבחר
async function callGemini(systemPrompt: string, history: any[], env: Env, model: string): Promise<string> {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("מפתח API של Gemini חסר (GEMINI_API_KEY).");
  }

  const modelConfig = new GeminiConfig();
  const apiBase = modelConfig.GOOGLE_API_BASE;
  const modelName = model || modelConfig.GOOGLE_CHAT_MODEL; // מודל דינמי או ברירת מחדל

  const url = `${apiBase}/models/${modelName}:generateContent?key=${apiKey}`;

  const contents = history.map((msg: any) => ({
    role: msg.role === "assistant" || msg.role === "model" ? "model" : "user",
    parts: [{ text: msg.content }]
  }));

  const payload = {
    contents: contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      temperature: 0.7
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API Error: ${errorText}`);
  }

  const data: any = await response.json();
  const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!replyText) {
    throw new Error("לא התקבלה תשובה תקינה מ-Gemini.");
  }
  return replyText;
}

// קריאה ל-OpenAI API עם תמיכה במודל שנבחר
async function callOpenAI(systemPrompt: string, history: any[], env: Env, model: string): Promise<string> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("מפתח API של OpenAI חסר (OPENAI_API_KEY).");
  }

  const modelConfig = new OpenAIConfig();
  const url = `${modelConfig.OPENAI_API_BASE}/chat/completions`;
  const modelName = model || modelConfig.OPENAI_CHAT_MODEL; // מודל דינמי או ברירת מחדל

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((msg: any) => ({
      role: msg.role === "assistant" || msg.role === "model" ? "assistant" : "user",
      content: msg.content
    }))
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: messages,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API Error: ${errorText}`);
  }

  const data: any = await response.json();
  const replyText = data.choices?.[0]?.message?.content;
  if (!replyText) {
    throw new Error("לא התקבלה תשובה תקינה מ-OpenAI.");
  }
  return replyText;
}

// קריאה ל-Cohere API (v2 Chat Completions Endpoint)
async function callCohere(systemPrompt: string, history: any[], env: Env, model: string): Promise<string> {
  const apiKey = env.COHERE_API_KEY;
  if (!apiKey) {
    throw new Error("מפתח API של Cohere חסר (COHERE_API_KEY).");
  }

  const modelConfig = new CohereConfig();
  const url = `${modelConfig.COHERE_API_BASE}/chat`;
  const modelName = model || modelConfig.COHERE_CHAT_MODEL;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((msg: any) => ({
      role: msg.role === "assistant" || msg.role === "model" ? "assistant" : "user",
      content: msg.content
    }))
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: messages
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cohere API Error: ${errorText}`);
  }

  const data: any = await response.json();

  let replyText = "";
  if (data.message?.content) {
    if (Array.isArray(data.message.content)) {
      replyText = data.message.content[0]?.text || "";
    } else if (typeof data.message.content === "string") {
      replyText = data.message.content;
    }
  }

  if (!replyText) {
    throw new Error("לא התקבלה תשובה תקינה מ-Cohere.");
  }

  return replyText;
}

// ניתוב חכם וחופשי לפי בחירת המשתמש (תמיכה מלאה ב-Gemini, OpenAI, Cohere)
async function callLLM(systemPrompt: string, history: any[], env: Env, provider: string, model: string): Promise<string> {
  if (provider === "openai") {
    return await callOpenAI(systemPrompt, history, env, model);
  } else if (provider === "cohere") {
    return await callCohere(systemPrompt, history, env, model);
  } else {
    // ברירת מחדל ל-Gemini
    return await callGemini(systemPrompt, history, env, model);
  }
}

// ==========================================
// 6. תהליך טיפול אסינכרוני מלא ברקע (עם קריאת המודל שנבחר ב-KV)
// ==========================================
async function handleMessageAndReply(chatId: number, text: string, env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN || "";
  if (!token) return;

  try {
    // שליפת מצב החיפוש הנוכחי
    const isNetOn = (await env.DATABASE.get(`net_mode_${chatId}`)) === "true";

    // שליפת המודל והספק הנבחרים של המשתמש מה-KV (תוך שמירה על תמיכה במשתנה הגלובלי AI_PROVIDER שלכם)
    const globalProvider = (env.AI_PROVIDER || "gemini").toLowerCase();
    const defaultProvider = globalProvider === "auto" ? "gemini" : globalProvider;
    const userProvider = (await env.DATABASE.get(`user_provider_${chatId}`)) || defaultProvider;

    // הגדרת מודל ברירת מחדל דינמי לפי הספק הפעיל
    let defaultModel = "gemini-2.5-flash";
    if (userProvider === "openai") defaultModel = "gpt-4o-mini";
    if (userProvider === "cohere") defaultModel = "command-r-plus";

    const userModel = (await env.DATABASE.get(`user_model_${chatId}`)) || defaultModel;

    let searchResults = "";
    let tempMessageId: number | null = null;

    if (isNetOn) {
      // הודעת המתנה
      const tempMsg = await sendTelegramMessage(chatId, "🔄 *מחפש מידע עדכני באינטרנט...*", token);
      if (tempMsg && tempMsg.result) {
        tempMessageId = tempMsg.result.message_id;
      }

      // ביצוע החיפוש
      searchResults = await fetchWebSearch(text, env);
    }

    // שליפת היסטוריית השיחות
    let history: any[] = [];
    const rawHistory = await env.DATABASE.get(`history_${chatId}`);
    if (rawHistory) {
      try {
        history = JSON.parse(rawHistory);
      } catch (_) {}
    }

    // הוספת הודעת המשתמש הנוכחית
    history.push({ role: "user", content: text });

    // הרכבת ה-System Prompt
    let systemPrompt = "You are a helpful and professional assistant.";
    if (isNetOn && searchResults) {
      systemPrompt += `\n\n[USER SEARCH CONTEXT]\nלהלן מידע עדכני שנמצא ברשת לגבי שאלת המשתמש. השתמש בו כדי לענות בצורה מבוססת ומדויקת:\n${searchResults}`;
    }

    // הרצת מודל השפה הדינמי שנבחר
    let botReply = "";
    try {
      botReply = await callLLM(systemPrompt, history, env, userProvider, userModel);
    } catch (error: any) {
      console.error("LLM Call Error:", error);
      botReply = `מצטער, חלה שגיאה בעיבוד התשובה: ${error.message}`;
    }

    // שמירת ההודעה של הבוט וצמצום היסטוריה
    history.push({ role: "model", content: botReply });
    const envConfig = new EnvironmentConfig();
    if (history.length > envConfig.MAX_HISTORY_LENGTH) {
      history = history.slice(history.length - envConfig.MAX_HISTORY_LENGTH);
    }

    // שמירה ב-KV WITH TTL של 24 שעות למניעת זבל
    await env.DATABASE.put(`history_${chatId}`, JSON.stringify(history), { expirationTtl: 86400 });

    // עדכון הודעת הביניים או שליחת הודעה חדשה
    if (isNetOn && tempMessageId) {
      await editTelegramMessage(chatId, tempMessageId, botReply, token);
    } else {
      await sendTelegramMessage(chatId, botReply, token);
    }

  } catch (err) {
    console.error("Error in background task handler:", err);
  }
}

// ==========================================
// 7. טיפול בלחיצות כפתור Inline (Callback Query Handler)
// ==========================================
async function handleCallbackQuery(callbackQuery: any, env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN || "";
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data || "";

  // שליחת תשובה מיידית לטלגרם כדי להסיר מיד את סמל הטעינה (Spinner) מהכפתור לשיפור ה-UX
  const answerUrl = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  await fetch(answerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQuery.id })
  });

  try {
    // תרחיש א': המשתמש בחר ספק (מעבר לתצוגת המודלים של אותו ספק)
    if (data.startsWith("select_provider:")) {
      const provider = data.split(":")[1];
      const providerInfo = PROVIDERS[provider];
      if (!providerInfo) return;

      // בניית רשימת כפתורי המודלים
      const keyboardRows = providerInfo.models.map((model: string) => {
        return [{ text: `🤖 ${model}`, callback_data: `select_model:${provider}:${model}` }];
      });
      // הוספת כפתור "חזור" לתפריט הראשי
      keyboardRows.push([{ text: "🔙 חזור לספקים", callback_data: "back_to_providers" }]);

      const keyboard = { inline_keyboard: keyboardRows };
      await editTelegramMessage(
        chatId,
        messageId,
        `⚙️ **תפריט דגמי ${providerInfo.name}**\nבחר את דגם המודל המועדף עליך מתוך הרשימה הבאה:`,
        token,
        keyboard
      );
    }

    // תרחיש ב': המשתמש בחר מודל ספציפי
    else if (data.startsWith("select_model:")) {
      const parts = data.split(":");
      const provider = parts[1];
      const model = parts[2];

      // שמירת בחירת המשתמש ב-KV
      await env.DATABASE.put(`user_provider_${chatId}`, provider);
      await env.DATABASE.put(`user_model_${chatId}`, model);

      // עדכון הודעת האישור הסופית בצ'אט
      let providerEmoji = "🤖";
      if (provider === "openai") providerEmoji = "⚡";
      if (provider === "cohere") providerEmoji = "🔮";

      const providerName = PROVIDERS[provider]?.name || provider;
      await editTelegramMessage(
        chatId,
        messageId,
        `✅ **הגדרות המודל עודכנו בהצלחה!**\n\n` +
        `🤖 ספק מוגדר: **${providerName}**\n` +
        `🎯 מודל פעיל: \`${model}\`\n\n` +
        `מעתה, כל הודעות השיחה והחיפושים הבאים שלך ישתמשו במודל זה.`,
        token
      );
    }

    // תרחיש ג': המשתמש בחר לחזור אחורה (מציג שוב רק את הספקים שיש להם מפתח פעיל)
    else if (data === "back_to_providers") {
      const buttons: any[] = [];
      const hasGemini = !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
      const hasOpenAI = !!env.OPENAI_API_KEY;
      const hasCohere = !!env.COHERE_API_KEY;

      if (hasGemini) {
        buttons.push({ text: "Google Gemini 🤖", callback_data: "select_provider:gemini" });
      }
      if (hasOpenAI) {
        buttons.push({ text: "OpenAI ⚡", callback_data: "select_provider:openai" });
      }
      if (hasCohere) {
        buttons.push({ text: "Cohere 🔮", callback_data: "select_provider:cohere" });
      }

      if (buttons.length === 0) {
        buttons.push({ text: "Google Gemini 🤖", callback_data: "select_provider:gemini" });
        buttons.push({ text: "OpenAI ⚡", callback_data: "select_provider:openai" });
        buttons.push({ text: "Cohere 🔮", callback_data: "select_provider:cohere" });
      }

      const keyboard = {
        inline_keyboard: chunkButtons(buttons, 2) // עימוד חכם
      };

      await editTelegramMessage(
        chatId,
        messageId,
        "⚙️ **תפריט הגדרות מודל**\nבחר ספק בינה מלאכותית מתוך הרשימה הבאה על מנת להציג את המודלים הזמינים שלו:",
        token,
        keyboard
      );
    }

  } catch (error) {
    console.error("Callback Query Error:", error);
  }
}

// ==========================================
// 8. נקודת הכניסה של קלאודפלייר (Cloudflare Worker Handler)
// ==========================================
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

      // ניתוב אסינכרוני עבור לחיצות כפתורי Inline
      if (update.callback_query) {
        ctx.waitUntil(handleCallbackQuery(update.callback_query, env));
        return new Response("OK", { status: 200 });
      }

      // ניתוב הודעות טקסט ופקודות רגילות
      if (update.message && update.message.chat) {
        const message = update.message;
        const chatId = message.chat.id;
        const text = (message.text || "").trim();

        // פקודות טלגרם מבוצעות סינכרונית באופן מיידי בשביל מענה מהיר של חלקיקי שניות
        if (text === "/start") {
          const welcomeText =
            "שלום! אני בוט הכל-יכול שלך. 🤖✨\n\n" +
            "פקודות זמינות לשימוש:\n" +
            "⚙️ /models - תפריט בחירה והחלפת מודלים\n" +
            "📊 /balance - בדיקת יתרת קרדיטים ב-Tavily API\n" +
            "🔍 /neton - הפעלת מצב חיפוש באינטרנט\n" +
            "💬 /netoff - כיבוי מצב חיפוש וחזרה לשיחה רגילה\n" +
            "🧹 /clear או /reset - איפוס מיידי של היסטוריית השיחה הנוכחית";

          await sendTelegramMessage(chatId, welcomeText, token);
          return new Response("OK", { status: 200 });
        }

        if (text === "/neton") {
          await env.DATABASE.put(`net_mode_${chatId}`, "true");
          await sendTelegramMessage(chatId, "🔍 **מצב חיפוש אינטרנט הופעל בהצלחה!**\nהשאילתות הבאות שלך יחופשו ברשת וייענו על בסיס מידע עדכני.", token);
          return new Response("OK", { status: 200 });
        }

        if (text === "/netoff") {
          await env.DATABASE.put(`net_mode_${chatId}`, "false");
          await sendTelegramMessage(chatId, "💬 **מצב חיפוש אינטרנט כבוי.**\nחוזר למצב שיחה רגיל מול המודל.", token);
          return new Response("OK", { status: 200 });
        }

        if (text === "/clear" || text === "/reset") {
          await env.DATABASE.delete(`history_${chatId}`);
          await sendTelegramMessage(chatId, "🧹 **היסטוריית השיחה אופסה בהצלחה.**", token);
          return new Response("OK", { status: 200 });
        }

        // פקודת בחירת מודלים מבוססת כפתורי מגע
        if (text === "/models") {
          await sendProviderMenu(chatId, token, env);
          return new Response("OK", { status: 200 });
        }

        // פקודת בדיקת יתרת קרדיטים קצרה ומאובטחת (אפשרות ב' עם טיפול שגיאות מורחב)
        if (text === "/balance") {
          const searchService = env.SEARCH_SERVICE;
          if (!searchService) {
            await sendTelegramMessage(chatId, "⚠️ **שגיאה:** שירות החיפוש (`SEARCH_SERVICE`) אינו מחובר לבוט הראשי.", token);
            return new Response("OK", { status: 200 });
          }

          const res = await searchService.fetch("http://searchworker/api/keys", {
            headers: { "x-api-key": env.TAVILY_PROXY_AUTH_KEY || "" }
          });

          // טיפול בטוח במקרה של כשל בפנייה ל-Proxy
          if (!res.ok) {
            const errBody = await res.text();
            await sendTelegramMessage(chatId, `⚠️ **שגיאה מה-Proxy של החיפושים:**\n\nסטטוס: \`${res.status}\`\nתשובה: \`${errBody}\``, token);
            return new Response("OK", { status: 200 });
          }

          const data: any = await res.json();
          const keys = data.keys; // חילוץ רשימת המפתחות מתוך שדה keys

          // בדיקה שהתשובה היא אכן מערך מפתחות למניעת קריסות map
          if (!keys || !Array.isArray(keys)) {
            await sendTelegramMessage(chatId, `⚠️ **שגיאה:** ה-Proxy החזיר נתון שאינו תואם למבנה הנדרש.\n\nנתון גולמי: \`${JSON.stringify(data)}\``, token);
            return new Response("OK", { status: 200 });
          }

          const msg = `📊 **Tavily Credits:**\n` + keys.map((k: any) => `🔑 \`${k.apiKey.slice(0, 8)}...${k.apiKey.slice(-4)}\`: *${(k.remainingCredit || 0).toLocaleString()}*`).join("\n");

          await sendTelegramMessage(chatId, msg, token);
          return new Response("OK", { status: 200 });
        }

        if (!text) {
          return new Response("OK", { status: 200 });
        }

        // עבור הודעות שיחה רגילות, מריצים את עיבוד המודל והחיפוש בצורה אסינכרונית ברקע
        ctx.waitUntil(handleMessageAndReply(chatId, text, env));
        return new Response("OK", { status: 200 });
      }

    } catch (err: any) {
      console.error("Worker Global Error:", err);
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  }
};
