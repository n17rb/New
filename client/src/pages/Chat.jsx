import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { shopName } from "../shop.js";
import { useNavigate, useParams } from "react-router-dom";
import { FiArrowRight, FiSend, FiImage, FiEdit, FiChevronLeft, FiCheck } from "react-icons/fi";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";
import { LogoMark } from "../components/Logo.jsx";
import { ROLE_LABELS } from "./More.jsx";

function timeOf(d) {
  return new Date(d).toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" });
}

function dayLabel(d) {
  const fmt = (x) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman" }).format(x);
  const day = fmt(new Date(d));
  const today = fmt(new Date());
  const yesterday = fmt(new Date(Date.now() - 86400000));
  if (day === today) return "اليوم";
  if (day === yesterday) return "أمس";
  return new Date(d).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long" });
}

function shortPreview(t) {
  if (t.last_image && !t.last_body) return "📷 صورة";
  return t.last_body || "";
}

// ---------------- صندوق الإدارة ----------------

function Inbox({ me }) {
  const navigate = useNavigate();
  const [threads, setThreads] = useState(null);
  const [staff, setStaff] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => api.getChatThreads().then(setThreads).catch((err) => setError(err.message));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  if (staff) {
    return (
      <div className="page">
        <button className="back-link" onClick={() => setStaff(null)}><FiArrowRight aria-hidden="true" /> الرسائل</button>
        <h1 className="title-lg">رسالة جديدة</h1>
        <div className="list-group">
          {staff.map((u) => (
            <button key={u.id} className="list-row" onClick={() => navigate(`/chat/${u.id}`)}>
              <span className="avatar">{u.full_name.trim().charAt(0)}</span>
              <span className="list-text">
                <span className="list-title">{u.full_name}</span>
                <div className="list-sub">{ROLE_LABELS[u.role] || "موظف"}</div>
              </span>
              <FiChevronLeft className="list-chevron" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="title-lg">رسائل الموظفين</h1>
        {me.can_reply && (
          <button
            className="icon-btn"
            onClick={() => api.getChatStaff().then(setStaff).catch((err) => setError(err.message))}
            aria-label="رسالة جديدة"
          >
            <FiEdit size={17} />
          </button>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}
      {!threads && !error && <p className="text-secondary">جاري التحميل...</p>}
      {threads && threads.length === 0 && (
        <div className="card text-secondary">ما في رسائل لسا. لما موظف يبعتلك رسالة بتطلع هون.</div>
      )}
      {threads && threads.length > 0 && (
        <div className="list-group">
          {threads.map((t) => (
            <button key={t.user_id} className="list-row" onClick={() => navigate(`/chat/${t.user_id}`)}>
              <span className="avatar">{t.full_name.trim().charAt(0)}</span>
              <span className="list-text">
                <span className="list-title" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>{t.full_name}</span>
                  <span className="text-secondary" style={{ fontSize: "0.72rem", fontWeight: 400, flexShrink: 0 }}>{dayLabel(t.last_at) === "اليوم" ? timeOf(t.last_at) : dayLabel(t.last_at)}</span>
                </span>
                <div className="list-sub" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: t.unread ? 700 : 400, color: t.unread ? "var(--text)" : undefined }}>
                    {!t.last_from_staff && "إنت: "}{shortPreview(t)}
                  </span>
                  {t.unread > 0 && <span className="unread-dot">{t.unread}</span>}
                </div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- المحادثة ----------------

function Thread({ threadUserId, me }) {
  const navigate = useNavigate();
  const { user } = usePerms();
  const [peer, setPeer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const bodyRef = useRef(null);
  const lastIdRef = useRef(0);
  const stickToBottom = useRef(true);

  const isStaffSide = threadUserId === user.id;
  const title = isStaffSide ? "الإدارة" : peer?.full_name || "...";

  function merge(newOnes) {
    if (!newOnes.length) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const next = [...prev, ...newOnes.filter((m) => !seen.has(m.id))];
      lastIdRef.current = next.length ? next[next.length - 1].id : 0;
      return next;
    });
  }

  useEffect(() => {
    let alive = true;
    lastIdRef.current = 0;
    setMessages([]);
    api.getChatThread(threadUserId)
      .then((r) => {
        if (!alive) return;
        setPeer(r.peer);
        merge(r.messages);
        api.markChatRead(threadUserId).catch(() => {});
      })
      .catch((err) => setError(err.message));

    // كل ٤ ثواني: آخر ٦٠ رسالة (بتجيب الجديد وبتحدّث علامة «انقرت» بنفس الطلب)
    const poll = setInterval(async () => {
      try {
        const r = await api.getChatThread(threadUserId);
        if (!alive) return;
        const newest = r.messages.length ? r.messages[r.messages.length - 1].id : 0;
        const gotNew = newest > lastIdRef.current;
        lastIdRef.current = newest;
        setMessages(r.messages);
        if (gotNew) api.markChatRead(threadUserId).catch(() => {});
      } catch {
        // بنحاول مرة ثانية بالدورة الجاية
      }
    }, 4000);
    return () => { alive = false; clearInterval(poll); };
  }, [threadUserId]);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = bodyRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError("");
    stickToBottom.current = true;
    try {
      const msg = await api.sendChatMessage(threadUserId, body);
      setText("");
      merge([msg]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function sendImage(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSending(true);
    setError("");
    stickToBottom.current = true;
    try {
      const msg = await api.sendChatImage(threadUserId, file, text.trim());
      setText("");
      merge([msg]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function remove(m) {
    try {
      await api.deleteChatMessage(m.id);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      setSelected(null);
    } catch (err) {
      setError(err.message);
    }
  }

  const canSend = isStaffSide ? me.can_chat_with_admin : me.can_reply;
  let lastDay = null;

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="chat-screen">
        <div className="chat-head">
          <button className="icon-btn" onClick={() => navigate(isStaffSide && !me.inbox ? "/more" : "/chat")} aria-label="رجوع">
            <FiArrowRight size={17} />
          </button>
          {isStaffSide ? (
            <span className="avatar" style={{ background: "var(--navy)", color: "#fff" }}><LogoMark size={22} color="#fff" strokeWidth={4} /></span>
          ) : (
            <span className="avatar">{title.trim().charAt(0)}</span>
          )}
          <div>
            <div style={{ fontWeight: 700 }}>{title}</div>
            <div className="text-secondary" style={{ fontSize: "0.75rem" }}>
              {isStaffSide ? shopName() : ROLE_LABELS[peer?.role] || "موظف"}
            </div>
          </div>
        </div>

        <div className="chat-body" ref={bodyRef} onScroll={onScroll}>
          {messages.length === 0 && (
            <p className="text-secondary" style={{ textAlign: "center", marginTop: 40 }}>
              {isStaffSide ? "ابعت رسالتك للإدارة — بيوصلهم إشعار فورًا." : "ابدأ المحادثة."}
            </p>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === user.id;
            const day = dayLabel(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            const deletable = mine && Date.now() - new Date(m.created_at).getTime() < 10 * 60 * 1000;
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {showDay && <div className="chat-day">{day}</div>}
                <div
                  className={`bubble ${mine ? "mine" : "theirs"}`}
                  onClick={() => deletable && setSelected(selected === m.id ? null : m.id)}
                >
                  {!mine && !m.from_staff && !isStaffSide && <div className="bubble-sender">{m.sender_name}</div>}
                  {!mine && !m.from_staff && isStaffSide && m.sender_name && <div className="bubble-sender">{m.sender_name}</div>}
                  {m.image_url && (
                    <a href={m.image_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      <img src={m.image_url} alt="صورة مرسلة" loading="lazy" />
                    </a>
                  )}
                  {m.body}
                  <div className="bubble-meta">
                    <span>{timeOf(m.created_at)}</span>
                    {mine && (m.read_at ? <span aria-label="انقرت">✓✓</span> : <FiCheck size={11} aria-label="انبعتت" />)}
                  </div>
                  {selected === m.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); remove(m); }}
                      style={{ display: "block", marginTop: 6, background: "rgba(255,255,255,0.2)", border: "none", color: "inherit", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: "0.8rem" }}
                    >
                      حذف الرسالة
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {error && <div className="error-box" style={{ margin: "8px 0 0" }}>{error}</div>}

        {canSend ? (
          <div className="chat-compose">
            <label className="chat-attach" aria-label="إرسال صورة">
              <FiImage size={18} />
              <input type="file" accept="image/*" onChange={sendImage} style={{ display: "none" }} disabled={sending} />
            </label>
            <textarea
              rows={1}
              value={text}
              placeholder="اكتب رسالة..."
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault();
                  send();
                }
              }}
              aria-label="الرسالة"
            />
            <button className="chat-send" disabled={sending || !text.trim()} onClick={send} aria-label="إرسال">
              <FiSend size={18} style={{ transform: "scaleX(-1)" }} />
            </button>
          </div>
        ) : (
          <p className="text-secondary" style={{ textAlign: "center", padding: "10px 0" }}>صلاحيتك هون مشاهدة فقط.</p>
        )}
      </div>
    </div>
  );
}

export default function Chat() {
  const { userId } = useParams();
  const { user } = usePerms();
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getChatMe().then(setMe).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!me) return <div className="page"><p className="text-secondary">جاري التحميل...</p></div>;

  if (userId) return <Thread threadUserId={Number(userId)} me={me} />;
  if (me.inbox) return <Inbox me={me} />;
  if (me.can_chat_with_admin) return <Thread threadUserId={user.id} me={me} />;
  return <div className="page"><div className="card text-secondary">ما عندك صلاحية الشات. اطلبها من المدير.</div></div>;
}
