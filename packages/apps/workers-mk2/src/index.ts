// index.ts - קובץ מאוחד, אסינכרוני ומאובטח לבוט הטלגרם (Multi-LLM + Web Search Proxy)

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
  TAVILY_PROXY_AUTH_KEY?: string;
  AI_PROVIDER?: string;
}

// ==========================================
// 2. מחלקות ההגדרה המקוריות של הפרויקט
// ==========================================
class AgentShareConfig {
  AI_PROVIDER = "auto";
  AI_IMAGE_PROVIDER = "auto";
  SYSTEM_INIT_MESSAGE = null;
}

class OpenAIConfig {
  OPENAI_API_KEY = [];
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
  GOOGLE_CHAT_MODEL = "gemini-1.5-flash";
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
  GROQ_CHAT_MODELS_LIST = "";
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
  DEFINE_KEYS = [];
}

class EnvironmentConfig {
  LANGUAGE = "he"; // עברית כברירת מחדל
  UPDATE_BRANCH = "master";
  CHAT_COMPLETE_API_TIMEOUT = 0;
  TELEGRAM_API_DOMAIN = "https://api.telegram.org";
  TELEGRAM_AVAILABLE_TOKENS = [];
  DEFAULT_PARSE_MODE = "Markdown";
  TELEGRAM_MIN_STREAM_INTERVAL = 0;
  TELEGRAM_PHOTO_SIZE_OFFSET = 1;
  TELEGRAM_IMAGE_TRANSFER_MODE = "base64";
  MODEL_LIST_COLUMNS = 1;
  I_AM_A_GENEROUS_PERSON = false;
  CHAT_WHITE_LIST = [];
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
  TELEGRAM_BOT_NAME = [];
  CHAT_GROUP_WHITE_LIST = [];
  GROUP_CHAT_BOT_ENABLE = true;
  GROUP_CHAT_BOT_SHARE_MODE = true;
  AUTO_TRIM_HISTORY = true;
  MAX_HISTORY_LENGTH = 8; // מגבלת זיכרון יעילה
  MAX_TOKEN_LENGTH = -1;
  HISTORY_IMAGE_PLACEHOLDER = null;
  HIDE_COMMAND_BUTTONS = [];
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
// 3. פונקציות עזר של טלגרם (עם מנגנון Fallback ל-Markdown)
// ==========================================
async function sendTelegramMessage(chatId: number, text: string, token: string): Promise<any> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown",
    }),
  });

  let data: any = await response.json();

  if (!data.ok && data.description && data.description.includes("can't find end of")) {
    console.warn("Telegram Markdown parsing failed, falling back to plain text.");
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });
    data = await response.json();
  }

  return data;
}

async function editTelegramMessage(chatId: number, messageId: number, text: string, token: string): Promise<any> {
  const url = `https://api.telegram.org/bot${token}/editMessageText`;
  
  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: "Markdown",
    }),
  });

  let data: any = await response.json();

  if (!data.ok && data.description && data.description.includes("can't find end of")) {
    console.warn("Telegram edit Markdown parsing failed, falling back to plain text.");
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text,
      }),
    });
    data = await response.json();
  }

  return data;
}

// ==========================================
// 4. פנייה לוורקר החיפוש עם ניהול Buffer בטוח ל-SSE
// ==========================================
async function fetchWebSearch(query: string, env: Env): Promise<string> {
  const searchService = env.SEARCH_SERVICE;
  if (!searchService) {
    console.error("SEARCH_SERVICE binding is missing in environment.");
    return "שגיאה פנימית: שירות החיפוש אינו מחובר (Service Binding חסר).";
  }

  const authKey = env.TAVILY_PROXY_AUTH_KEY || "";

  try {
    const response = await searchService.fetch("http://searchworker/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "tavily_search",
          arguments: {
            query: query,
            search_depth: "advanced"
          }
        },
        id: 1
      }),
    });

    if (!response.ok) {
      return `שגיאה בפנייה לשרת החיפוש: ${response.statusText}`;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    let searchResultText = "";
    let done = false;
    let buffer = ""; 

    if (reader) {
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          buffer += chunk;
          
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6).trim();
              if (dataStr === "[DONE]") continue;
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.result?.content?.[0]?.text) {
                  searchResultText += parsed.result.content[0].text;
                } else if (parsed.content?.[0]?.text) {
                  searchResultText += parsed.content[0].text;
                } else if (parsed.text) {
                  searchResultText += parsed.text;
                }
              } catch (e) {
                // התעלמות
              }
            }
          }
        }
      }
      
      if (buffer) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
          const dataStr = trimmed.slice(6).trim();
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.result?.content?.[0]?.text) {
              searchResultText += parsed.result.content[0].text;
            } else if (parsed.content?.[0]?.text) {
              searchResultText += parsed.content[0].text;
            } else if (parsed.text) {
              searchResultText += parsed.text;
            }
          } catch (e) {}
        }
      }
    }

    return searchResultText || "לא נמצאו תוצאות חיפוש רלוונטיות.";
  } catch (error: any) {
    console.error("Search failed:", error);
    return `שגיאה במהלך ביצוע החיפוש: ${error.message}`;
  }
}

// ==========================================
// 5. קריאות ל-APIs של ה-LLMs (מנועי העיבוד)
// ==========================================

// קריאה ל-Gemini API
async function callGemini(systemPrompt: string, history: any[], env: Env): Promise<string> {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("מפתח API של Gemini חסר (GEMINI_API_KEY).");
  }

  const modelConfig = new GeminiConfig();
  const apiBase = modelConfig.GOOGLE_API_BASE;
  const modelName = modelConfig.GOOGLE_CHAT_MODEL;

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

// קריאה ל-OpenAI API
async function callOpenAI(systemPrompt: string, history: any[], env: Env): Promise<string> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("מפתח API של OpenAI חסר (OPENAI_API_KEY).");
  }

  const modelConfig = new OpenAIConfig();
  const url = `${modelConfig.OPENAI_API_BASE}/chat/completions`;

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
      model: modelConfig.OPENAI_CHAT_MODEL,
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

// ניתוב חכם בין מודלים
async function callLLM(systemPrompt: string, history: any[], env: Env): Promise<string> {
  const provider = (env.AI_PROVIDER || "auto").toLowerCase();

  let activeProvider = provider;
  if (activeProvider === "auto") {
    if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) {
      activeProvider = "gemini";
    } else if (env.OPENAI_API_KEY) {
      activeProvider = "openai";
    } else {
      activeProvider = "gemini";
    }
  }

  switch (activeProvider) {
    case "gemini":
    case "google":
      return await callGemini(systemPrompt, history, env);
    case "openai":
      return await callOpenAI(systemPrompt, history, env);
    default:
      return await callGemini(systemPrompt, history, env);
  }
}

// ==========================================
// 6. תהליך טיפול אסינכרוני מלא ברקע (Background Task Handler)
// ==========================================
async function handleMessageAndReply(chatId: number, text: string, env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN || "";
  if (!token) return;

  try {
    // שליפת מצב החיפוש הנוכחי
    const isNetOn = (await env.DATABASE.get(`net_mode_${chatId}`)) === "true";

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

    // הרצת מודל השפה
    let botReply = "";
    try {
      botReply = await callLLM(systemPrompt, history, env);
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

    // שמירה ב-KV עם הגדרת TTL של 24 שעות (86400 שניות) למניעת הצטברות זבל
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
// 7. נקודת הכניסה של קלאודפלייר (Cloudflare Worker Handler)
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
      
      if (!update.message || !update.message.chat) {
        return new Response("OK", { status: 200 });
      }

      const message = update.message;
      const chatId = message.chat.id;
      const text = (message.text || "").trim();

      // פקודות טלגרם מבוצעות סינכרונית באופן מיידי בשביל מענה מהיר של חלקיקי שניות
      if (text === "/start") {
        const welcomeText = 
          "שלום! אני בוט הכל-יכול שלך. 🤖✨\n\n" +
          "פקודות זמינות לשימוש:\n" +
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

      if (!text) {
        return new Response("OK", { status: 200 });
      }

      // עבור הודעות שיחה רגילות, מחזירים מיידית 200 OK לטלגרם כדי למנוע כפילויות,
      // ומריצים את עיבוד המודל והחיפוש בצורה אסינכרונית ברקע באמצעות waitUntil
      ctx.waitUntil(handleMessageAndReply(chatId, text, env));

      return new Response("OK", { status: 200 });

    } catch (err: any) {
      console.error("Worker Global Error:", err);
      // תמיד מחזירים 200 OK לטלגרם במקרה של שגיאת קלט, כדי למנוע ממנו לנסות שוב ושוב לשלוח בקשה פגומה
      return new Response("OK", { status: 200 });
    }
  }
};
