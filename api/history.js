/**
 * api/history.js —— 起名历史查询接口
 * GET /api/history?limit=10
 */
import { createClient } from '@supabase/supabase-js';

let supabase = null;
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!supabase) supabase = createClient(url, key);
  return supabase;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: '仅支持 GET 请求' });
  }

  const db = getSupabase();
  if (!db) {
    return res.status(200).json({ items: [], notice: '未配置 Supabase，历史记录不可用' });
  }

  const raw = Number(req.query?.limit ?? 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 30) : 10;

  try {
    const { data, error } = await db
      .from('name_history')
      .select('id, user_requirement, name_result, model_name, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(500).json({ error: `查询失败：${error.message}` });
    }
    return res.status(200).json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: `查询异常：${e.message}` });
  }
}
