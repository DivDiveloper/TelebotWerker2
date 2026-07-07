export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Only POST allowed', { status: 405 });
    }

    try {
      const update: any = await request.json();
      const message = update.message;

      if (!message || !message.text) {
        return new Response('OK', { status: 200 });
      }

      const chatId = message.chat.id;
      const query = message.text.trim();

      // פקודות מצב רשת
      if (query === '/neton') {
        ctx.waitUntil(setChatMode(chatId, 'neton', env));
        return new Response('OK', { status: 200 });
      }

      if (query === '/netoff') {
        ctx.waitUntil(setChatMode(chatId, 'netoff', env));
        return new Response('OK', { status: 200 });
      }

      // פקודת התחלה
      if (query === '/start') {
        const welcomeText = "שלום! אני בוט חכם המחובר ל-Gemini.\n\n" +
                            "💬 כרגע אני ב**מצב שיחה רגיל**.\n" +
                            "🌐 להפעלת חיפוש מידע עדכני ברשת, שלח לי: /neton\n" +
                            "❌ לכיבוי החיפוש וחזרה לשיחה רגילה, שלח לי: /netoff";
        ctx.waitUntil(sendTelegramMessage(chatId, welcomeText, env.TELEGRAM_BOT_TOKEN, false));
        return new Response('OK', { status: 200 });
      }

      ctx.waitUntil(handleSearchAndReply(chatId, query, env));

      return new Response('OK', { status: 200 });

    } catch (err: any) {
      console.error('Error in fetch:', err);
      return new Response('Error', { status: 500 });
    }
  }
};

async function setChatMode(chatId: number, mode: string, env: any): Promise<void> {
  if (env.DATABASE) {
    try {
      await env.DATABASE.put(`chat_mode_${chatId}`, mode);
    } catch (e) {
      console.error('Failed to save mode to KV:', e);
    }
  }

  const responseText = mode === 'neton' 
    ? "🌐 **מצב חיפוש באינטרנט הופעל!**\nמעתה אבצע חיפוש ברשת באמצעות Tavily Proxy לפני כל תשובה כדי לספק לך את המידע העדכני ביותר."
    : "💬 **מצב שיחה רגילה הופעל.**\nמעתה אענה לך ישירות מהידע שלי, ללא ביצוע חיפושים ברשת.";

  await sendTelegramMessage(chatId, responseText, env.TELEGRAM_BOT_TOKEN, true);
}

async function handleSearchAndReply(chatId: number, query: string, env: any): Promise<void> {
  let placeholderMsgId: number | null = null;
  try {
    let mode = 'netoff';
    const modeKey = `chat_mode_${chatId}`;
    if (env.DATABASE) {
      try {
        const cachedMode = await env.DATABASE.get(modeKey);
        if (cachedMode) {
          mode = cachedMode;
        }
      } catch (e) {
        console.error('Failed to load history from KV:', e);
      }
    }

    let searchContext = "";
    if (mode === 'neton') {
      placeholderMsgId = await sendTelegramMessage(chatId, "🔍 מחפש באינטרנט ומעבד תשובה...", env.TELEGRAM_BOT_TOKEN, false);
      if (env.SEARCH_SERVICE) {
        try {
          const mcpResponse = await env.SEARCH_SERVICE.fetch('https://tavily-proxy/mcp', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/event-stream',
              'x-api-key': env.TAVILY_PROXY_AUTH_KEY || ''
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name: "tavily-search",
                arguments: {
                  query: query
                }
              }
            })
          });

          if (mcpResponse.ok) {
            const mcpText = await mcpResponse.text();
            let jsonStr = mcpText;

            // פיענוח חכם של תזרים אירועים (SSE) במידה והתקבל
            if (mcpText.includes('event:') || mcpText.includes('data:')) {
              const lines = mcpText.split('\n');
              for (const line of lines) {
                if (line.trim().startsWith('data:')) {
                  jsonStr = line.replace(/^data:\s*/, '').trim();
                  break;
                }
              }
            }

            const mcpData = JSON.parse(jsonStr);

            if (mcpData.result?.content?.[0]?.text) {
              searchContext = mcpData.result.content[0].text;
            } else {
              searchContext = "No search results returned from proxy.";
            }
          } else {
            console.error('Proxy failed with status:', mcpResponse.status);
            searchContext = "Web search was unavailable.";
          }
        } catch (e) {
          console.error("Search service error:", e);
          searchContext = "Error performing web search.";
        }
      }
    } else {
      placeholderMsgId = await sendTelegramMessage(chatId, "⚡ מנסח תשובה...", env.TELEGRAM_BOT_TOKEN, false);
    }

    // טעינת היסטוריית שיחה מתוך ה-KV
    const historyKey = `chat_history_${chatId}`;
    let history: any[] = [];
    if (env.DATABASE) {
      try {
        const cachedHistory = await env.DATABASE.get(historyKey);
        if (cachedHistory) {
          history = JSON.parse(cachedHistory);
        }
      } catch (e) {
        console.error('Failed to load history from KV:', e);
      }
    }

    if (history.length > 20) {
      history = history.slice(-20);
    }

    let systemInstruction = "";
    let userMessageContent = "";

    if (mode === 'neton') {
      systemInstruction = "You are a helpful AI search assistant. Answer the user's query accurately and concisely in Hebrew based on the provided search results. Cite your sources using [1], [2], etc.";
      userMessageContent = `User Query: ${query}\n\nSearch Results:\n${searchContext}\n\nPlease generate a response in Hebrew based on these results.`;
    } else {
      systemInstruction = "You are a helpful, warm, and expert conversational AI assistant. Answer the user's query clearly and concisely in Hebrew.";
      userMessageContent = query;
    }

    history.push({
      role: "user",
      parts: [{ text: userMessageContent }]
    });

    const aiAnswer = await queryGemini(history, systemInstruction, env.API_KEY || env.GEMINI_API_KEY);

    history.push({
      role: "model",
      parts: [{ text: aiAnswer }]
    });

    if (env.DATABASE) {
      try {
        await env.DATABASE.put(historyKey, JSON.stringify(history), { expirationTtl: 86400 });
      } catch (e) {
        console.error('Failed to save history to KV:', e);
      }
    }

    if (placeholderMsgId) {
      await deleteTelegramMessage(chatId, placeholderMsgId, env.TELEGRAM_BOT_TOKEN);
    }
    await sendTelegramMessage(chatId, aiAnswer, env.TELEGRAM_BOT_TOKEN, true);

  } catch (error) {
    console.error('Error in background process:', error);
    if (placeholderMsgId) {
      await deleteTelegramMessage(chatId, placeholderMsgId, env.TELEGRAM_BOT_TOKEN);
    }
    await sendTelegramMessage(chatId, "⚠️ מצטער, אירעה שגיאה בעיבוד הבקשה שלך.", env.TELEGRAM_BOT_TOKEN, false);
  }
}

async function queryGemini(contents: any[], systemInstruction: string, apiKey: string): Promise<string> {
  const finalKey = apiKey;
  if (!finalKey) throw new Error('GEMINI_API_KEY is missing');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${finalKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: contents,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API failed: ${err}`);
  }
  const data: any = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function sendTelegramMessage(chatId: number, text: string, botToken: string, useMarkdown: boolean = true): Promise<number> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = { chat_id: chatId, text: text };
  if (useMarkdown) (body as any).parse_mode = 'Markdown';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    if (useMarkdown) return await sendTelegramMessage(chatId, text, botToken, false);
    throw new Error(`Telegram API failed: ${await response.text()}`);
  }
  const result: any = await response.json();
  return result.result.message_id;
}

async function deleteTelegramMessage(chatId: number, messageId: number, botToken: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/deleteMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId })
    });
  } catch (e) {}
}
