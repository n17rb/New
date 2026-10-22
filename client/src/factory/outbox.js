import { useEffect, useState } from "react";
import { request, peek } from "../api.js";

// ============================================================
// صندوق الصادر: عمليات السائق (تسليم، بيع، مصروف، ما تم) بتنحفظ على التلفون إذا ما في شبكة،
// وبتنبعت لحالها أول ما ترجع — كل عملية إلها مفتاح (client_key) فما بتنسجّل مرتين أبدًا
// ============================================================
const listeners = new Set();
const boxKey = () => {
  try {
    const u = JSON.parse(localStorage.getItem("user") || "null");
    const s = JSON.parse(localStorage.getItem("shop") || "null");
    return `fx-outbox:${s?.id ?? 0}:${u?.id ?? 0}`;
  } catch { return "fx-outbox:0:0"; }
};
function read() {
  try { const v = JSON.parse(localStorage.getItem(boxKey()) || "null"); return v && Array.isArray(v.items) ? v : { items: [], failed: [] }; } catch { return { items: [], failed: [] }; }
}
let mem = null;
function load() { if (!mem) mem = read(); return mem; }
function save(v) {
  mem = v;
  try { localStorage.setItem(boxKey(), JSON.stringify(v)); } catch { /* المساحة */ }
  listeners.forEach((f) => f(v));
}
const newKey = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// بيبعت العملية؛ إذا ما في شبكة بتنحفظ وبيرجع { queued: true }
export async function sendOrQueue({ kind, ref = null, path, body = {}, label }) {
  const item = { key: newKey(), kind, ref, path, body: { ...body, client_key: undefined }, label, at: new Date().toISOString() };
  item.body.client_key = item.key;
  try {
    const data = await request(`/factory${path}`, { method: "POST", body: item.body });
    return { ok: true, data };
  } catch (e) {
    if (!e.offline) throw e;
    const v = load();
    save({ ...v, items: [...v.items, item] });
    kick(15000);
    return { queued: true, item };
  }
}

let running = false;
export async function flush() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const v = load();
      const it = v.items[0];
      if (!it) break;
      try {
        await request(`/factory${it.path}`, { method: "POST", body: it.body });
        const now = load();
        save({ ...now, items: now.items.filter((x) => x.key !== it.key) });
      } catch (e) {
        if (e.offline || e.data?.code === "IN_PROGRESS") break; // لسا ما في شبكة — منجرّب بعدين
        // السيرفر رفضها (مثلًا الطلب انلغى) — منطلّعها وبنخبّر السائق
        const now = load();
        save({ items: now.items.filter((x) => x.key !== it.key), failed: [...now.failed, { ...it, error: e.message }] });
      }
    }
  } finally { running = false; }
}

let timer = null;
function kick(ms = 0) { clearTimeout(timer); timer = setTimeout(() => flush().catch(() => {}), ms); }
if (typeof window !== "undefined") {
  window.addEventListener("online", () => kick(500));
  setInterval(() => { if (load().items.length) flush().catch(() => {}); }, 30000);
  setTimeout(() => kick(2000), 0);
}

export function dismissFailed(key) {
  const v = load();
  save({ ...v, failed: v.failed.filter((x) => x.key !== key) });
}

export function useOutbox() {
  const [v, setV] = useState(load);
  useEffect(() => { listeners.add(setV); return () => listeners.delete(setV); }, []);
  return v;
}

// آخر نسخة محفوظة من رحلتي (لو التطبيق انفتح بدون شبكة)
export function cachedToday() {
  return peek("/factory/driver/today");
}
