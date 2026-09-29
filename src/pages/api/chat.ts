import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => null);
    const userMessage = typeof body?.message === 'string' ? body.message.trim() : '';
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : '';

    if (!userMessage) {
      return new Response(JSON.stringify({ error: '消息不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (userMessage.length > 10000) {
      return new Response(JSON.stringify({ error: '消息长度不能超过 10000 个字符' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const difyApiKey = import.meta.env.DIFY_API_KEY;
    if (!difyApiKey) {
      console.error('DIFY_API_KEY 未配置');
      return new Response(JSON.stringify({ error: '聊天服务未完成配置' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const difyApiUrl = import.meta.env.DIFY_API_URL || 'http://localhost:8080/v1/chat-messages';

    const response = await fetch(difyApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${difyApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        inputs: {},
        query: userMessage,
        response_mode: 'streaming',
        conversation_id: conversationId,
        user: 'astro-panel-user',
      }),
      signal: request.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Dify API 请求失败:', {
        status: response.status,
        details: errorText.slice(0, 500)
      });
      return new Response(JSON.stringify({ error: 'Dify 服务暂时不可用' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    });

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }

    console.error('后端捕获到错误:', error);
    return new Response(JSON.stringify({ error: '聊天服务发生内部错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
