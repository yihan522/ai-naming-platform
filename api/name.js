/**
 * api/name.js —— AI 起名核心接口（阶段1单模型 → 阶段2多模型配置版）
 *
 * 核心思路：
 * 1. 所有支持 OpenAI 兼容网关的模型（豆包/DeepSeek/通义千问/Kimi）共用同一段调用代码；
 * 2. 差异只体现在 modelConfigMap 的 baseURL / apiKey / model 三个字段；
 * 3. 上游开启 stream:true，后端逐片读取 delta.content，再以 SSE 推给浏览器；
 * 4. 生成结束后把「需求 + 名字方案 + 模型名」写入 Supabase。
 */
import { createClient } from '@supabase/supabase-js';

// ============ 1. 模型配置表 modelConfigMap ============
const modelConfigMap = {
  doubao: {
    label: '豆包（火山方舟）',
    baseURL: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v1',
    apiKey: process.env.DOUBAO_API_KEY,
    model: process.env.DOUBAO_MODEL || 'doubao-pro-32k',
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },
  qwen: {
    label: '通义千问（DashScope）',
    // 注意：必须用 compatible-mode 地址，普通 dashscope 地址不兼容 OpenAI 协议
    baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.QWEN_API_KEY,
    model: process.env.QWEN_MODEL || 'qwen-plus',
  },
  kimi: {
    label: 'Kimi（月之暗面）',
    baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    apiKey: process.env.KIMI_API_KEY,
    model: process.env.KIMI_MODEL || 'moonshot-v1-8k',
  },
};

// ============ 2. Supabase 客户端（懒加载，未配置时自动降级） ============
let supabase = null;
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!supabase) supabase = createClient(url, key);
  return supabase;
}

// ============ 3. 系统提示词 ============
const SYSTEM_PROMPT = `你是一位精通中文、英文与中日韩文化的起名顾问。
请严格根据用户的需求（性别、姓氏、风格、字数、寓意偏好、避讳字等）起名，规则如下：
1. 给出 3 组方案，每组给 3 个备选名字；
2. 每个名字必须包含：拼音/读音、字义拆解、整体寓意、适用场景，共 4 项；
3. 风格要贴合用户要求（如国风、现代简约、英文名、中性风等）；
4. 不要输出与起名无关的寒暄；
5. 输出格式固定为 Markdown：
## 方案一｜主题小标题
- **名字**（拼音）：字义拆解。整体寓意……｜适用场景：……
依次写完三个方案，最后补一句“综合推荐”并说明理由。`;

function buildUserPrompt(requirement, style) {
  return `【起名需求】${requirement}
${style ? `【风格偏好】${style}\n` : ''}请按照系统要求起名。`;
}

// ============ 4. SSE 小工具 ============
function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ============ 5. 主处理函数 ============
export default async function handler(req, res) {
  if (req.method === 'GET') {
    // 供前端拉取可选模型列表
    const models = Object.entries(modelConfigMap).map(([key, cfg]) => ({
      key,
      label: cfg.label,
      configured: Boolean(cfg.apiKey),
    }));
    return res.status(200).json({ models });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  // Vercel 会自动解析 JSON body；本地直连时兜底手动解析
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const requirement = String(body.requirement || '').trim();
  const style = String(body.style || '').trim();
  const modelKey = String(body.model || 'doubao').trim();

  if (!requirement) {
    return res.status(400).json({ error: '请先填写起名需求' });
  }
  if (requirement.length > 200) {
    return res.status(400).json({ error: '需求描述请控制在 200 字以内' });
  }

  const config = modelConfigMap[modelKey];
  if (!config) {
    return res.status(400).json({ error: `未知模型：${modelKey}` });
  }
  if (!config.apiKey) {
    return res.status(500).json({
      error: `模型「${config.label}」尚未配置密钥，请在 .env 或 Vercel 环境变量中补充`,
    });
  }

  // ---- 开启 SSE 响应头 ----
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  sse(res, { type: 'meta', model: modelKey, label: config.label, model_name: config.model });

  let fullText = '';
  try {
    const upstream = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(requirement, style) },
        ],
        stream: true,
        temperature: 0.85,
        max_tokens: 1600,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '');
      sse(res, { type: 'error', message: `上游返回 ${upstream.status}：${errText.slice(0, 300)}` });
      return res.end();
    }

    // ---- 逐片解析 SSE ----
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 最后一行可能不完整，留到下一轮

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const chunk = JSON.parse(dataStr);
          const delta = chunk.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            sse(res, { type: 'delta', text: delta });
          }
        } catch {
          // 心跳包或非 JSON 分片，忽略
        }
      }
    }

    // ---- 落库：失败不影响已经推给用户的结果 ----
    let historyId = null;
    const db = getSupabase();
    if (db && fullText) {
      try {
        const { data, error } = await db
          .from('name_history')
          .insert({
            user_requirement: style ? `${requirement}（风格：${style}）` : requirement,
            name_result: fullText,
            model_name: `${config.label} / ${config.model}`,
          })
          .select('id');
        if (error) {
          sse(res, { type: 'warning', message: `已生成，但历史记录写入失败：${error.message}` });
        } else {
          // PostgREST 有时返回数组、有时返回单对象，两种都兼容
          historyId = (Array.isArray(data) ? data[0]?.id : data?.id) ?? null;
        }
      } catch (e) {
        sse(res, { type: 'warning', message: `历史记录写入异常：${e.message}` });
      }
    } else if (!db) {
      sse(res, { type: 'warning', message: '未配置 Supabase，本次结果不会写入历史记录' });
    }

    sse(res, { type: 'done', history_id: historyId, length: fullText.length });
  } catch (err) {
    sse(res, { type: 'error', message: `调用失败：${err.message}` });
  } finally {
    res.end();
  }
}
