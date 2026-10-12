import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiArrowRight, FiImage, FiSend, FiCheck } from "react-icons/fi";

function dayLabel(d) {
  const date = new Date(d);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "اليوم";
  if (same(date, yest)) return "مبارح";
  return date.toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long" });
}

function timeOf(d) {
  return new Date(d).toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" });
}

// محادثة بنفس شكل شات الموظفين — للدعم الفني (من جهة المحل ومن جهة إدارة موج)
// load(): بيرجّع {messages, ...}. isMine(m). send(text). sendImage(file, text). markRead().
export default function ChatView({ title, subtitle, avatar, backTo, load, isMine, send, sendImage, markRead, emptyText, readOnly = false, onLoaded }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const bodyRef = useRef(null);
  const stickToBottom = useRef(true);
  const lastIdRef = useRef(0);

  async function refresh(first = false) {
    try {
      const r = await load();
      const msgs = r.messages || [];
      const newest = msgs.length ? msgs[msgs.length - 1].id : 0;
      const gotNew = newest > lastIdRef.current;
      lastIdRef.current = newest;
      setMessages(msgs);
      if (first) onLoaded?.(r);
      if ((first || gotNew) && !readOnly) markRead?.().catch?.(() => {});
    } catch (err) {
      if (first) setError(err.message);
    } finally {
      if (first) setLoaded(true);
    }
  }

  useEffect(() => {
    refresh(true);
    const t = setInterval(() => refresh(false), 5000);
    return () => clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = bodyRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function merge(msg) {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    lastIdRef.current = Math.max(lastIdRef.current, msg.id);
  }

  async function doSend() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError("");
    stickToBottom.current = true;
    try {
      merge(await send(body));
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function doImage(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSending(true);
    setError("");
    stickToBottom.current = true;
    try {
      merge(await sendImage(file, text.trim()));
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  let lastDay = null;
  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="chat-screen">
        <div className="chat-head">
          <button className="icon-btn" onClick={() => navigate(backTo)} aria-label="رجوع">
            <FiArrowRight size={17} />
          </button>
          {avatar}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{title}</div>
            {subtitle && <div className="text-secondary" style={{ fontSize: "0.75rem" }}>{subtitle}</div>}
          </div>
        </div>

        <div className="chat-body" ref={bodyRef} onScroll={onScroll}>
          {loaded && messages.length === 0 && (
            <p className="text-secondary" style={{ textAlign: "center", marginTop: 40, padding: "0 20px" }}>{emptyText}</p>
          )}
          {messages.map((m) => {
            const mine = isMine(m);
            const day = dayLabel(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {showDay && <div className="chat-day">{day}</div>}
                <div className={`bubble ${mine ? "mine" : "theirs"}`}>
                  {!mine && m.sender_name && <div className="bubble-sender">{m.sender_name}</div>}
                  {m.image_url && (
                    <a href={m.image_url} target="_blank" rel="noreferrer">
                      <img src={m.image_url} alt="صورة مرسلة" loading="lazy" />
                    </a>
                  )}
                  {m.body}
                  <div className="bubble-meta">
                    <span>{timeOf(m.created_at)}</span>
                    {mine && (m.read_at ? <span aria-label="انقرت">✓✓</span> : <FiCheck size={11} aria-label="انبعتت" />)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {error && <div className="error-box" style={{ margin: "8px 0 0" }}>{error}</div>}

        {readOnly ? (
          <p className="text-secondary" style={{ textAlign: "center", padding: "10px 0" }}>وضع المشاهدة.</p>
        ) : (
          <div className="chat-compose">
            <label className="chat-attach" aria-label="إرسال صورة">
              <FiImage size={18} />
              <input type="file" accept="image/*" onChange={doImage} style={{ display: "none" }} disabled={sending} />
            </label>
            <textarea
              rows={1}
              value={text}
              placeholder="اكتب رسالة..."
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault();
                  doSend();
                }
              }}
              aria-label="الرسالة"
            />
            <button className="chat-send" disabled={sending || !text.trim()} onClick={doSend} aria-label="إرسال">
              <FiSend size={18} style={{ transform: "scaleX(-1)" }} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SupportAvatar({ photo, size = 40 }) {
  if (photo) return <img src={photo} alt="" className="avatar" style={{ width: size, height: size, objectFit: "cover", padding: 0 }} />;
  return (
    <span className="avatar" style={{ width: size, height: size, background: "var(--brand-grad)", color: "#fff" }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 48 48" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
        <path d="M8 16c3 2.5 7 2.8 10 .5s7-4 10-2 6 4 9 3 3.6-1.8 3.6-1.8" />
        <path d="M8 25c3 2.5 7 2.8 10 .5s7-4 10-2 6 4 9 3 3.6-1.8 3.6-1.8" />
        <path d="M8 34c3 2.5 7 2.8 10 .5s7-4 10-2 6 4 9 3 3.6-1.8 3.6-1.8" />
      </svg>
    </span>
  );
}
