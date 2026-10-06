import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { FiBell, FiCheckCircle, FiSend, FiCalendar } from "react-icons/fi";
import { BottleTypeBadge } from "../components/BottleType.jsx";
import { enablePush, isPushSupported, isIOS, isStandalone, isCurrentDeviceSubscribed } from "../push.js";

function getPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function DevicePushCard() {
  const [permission, setPermission] = useState(getPermission());
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    isCurrentDeviceSubscribed().then(setSubscribed);
  }, []);

  async function handleEnable() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await enablePush();
      setSubscribed(true);
      setMessage("تم التفعيل ✓ — رح توصلك الإشعارات حتى لو التطبيق مسكّر.");
    } catch (err) {
      setError(err.message);
    } finally {
      setPermission(getPermission());
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.testPush();
      setMessage("انبعث إشعار تجربة — سكّر التطبيق وشوف إذا وصل.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // آيفون: الإشعارات بتشتغل بس لما التطبيق يكون مضاف للشاشة الرئيسية
  if (isIOS() && !isStandalone()) {
    return (
      <div className="card">
        <h2 className="title-md" style={{ marginTop: 0 }}>إشعارات الجهاز (آيفون)</h2>
        <p style={{ marginTop: 0, fontSize: "0.9rem" }}>
          عشان توصلك الإشعارات على الآيفون لازم تضيف التطبيق للشاشة الرئيسية أول:
        </p>
        <ol style={{ paddingInlineStart: 20, fontSize: "0.9rem", lineHeight: 1.8, margin: 0 }}>
          <li>افتح الموقع من متصفح Safari</li>
          <li>اكبس زر المشاركة (المربع اللي فيه سهم لفوق)</li>
          <li>اختار «إضافة إلى الشاشة الرئيسية»</li>
          <li>افتح التطبيق من الأيقونة الجديدة وارجع لهاي الصفحة</li>
        </ol>
      </div>
    );
  }

  if (!isPushSupported()) {
    return (
      <div className="card text-secondary" style={{ fontSize: "0.85rem" }}>
        هذا المتصفح ما بيدعم إشعارات الجهاز. جرّب تفتح التطبيق من Chrome على أندرويد أو من الشاشة الرئيسية على الآيفون.
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div className="card text-secondary" style={{ fontSize: "0.85rem" }}>
        إشعارات الجهاز مقفولة لهذا التطبيق. افتح إعدادات المتصفح ← إعدادات المواقع ← الإشعارات، واسمح لها، وبعدين ارجع لهاي الصفحة.
      </div>
    );
  }

  return (
    <div className="card">
      {subscribed ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--success)", fontWeight: 700, marginBottom: 10 }}>
            <FiCheckCircle /> إشعارات الجهاز مفعّلة على هذا الموبايل
          </div>
          <button className="btn-secondary" disabled={busy} onClick={handleTest} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <FiSend /> ابعث إشعار تجربة
          </button>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>فعّل إشعارات الجهاز عشان يطلعلك تنبيه زي الواتساب لما ينضاف طلب على رحلة — حتى لو التطبيق مسكّر.</p>
          <button className="btn-primary" disabled={busy} onClick={handleEnable} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <FiBell /> {busy ? "جاري التفعيل..." : "تفعيل إشعارات الجهاز"}
          </button>
        </>
      )}
      {message && <div style={{ color: "var(--success)", marginTop: 10, fontSize: "0.9rem" }}>{message}</div>}
      {error && <div className="error-box" style={{ marginTop: 10, marginBottom: 0 }}>{error}</div>}
    </div>
  );
}

const DAY_LABELS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function todayStatusLabel(status) {
  if (!status) return { text: "لسا ما انطلب", color: "var(--warning)" };
  if (status === "DELIVERED") return { text: "تم التسليم ✓", color: "var(--success)" };
  if (status === "IN_ROUTE") return { text: "بالطريق 🚚", color: "var(--primary, #0094FF)" };
  if (status === "FAILED") return { text: "تعذّر التسليم", color: "var(--urgent)" };
  return { text: "انطلب ✓", color: "var(--success)" };
}

function ScheduleRow({ c, highlight, onOpen }) {
  const status = highlight ? todayStatusLabel(c.today_order_status) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {c.customer_name}
          <BottleTypeBadge type={c.bottle_type} />
        </div>
        {status && <span style={{ color: status.color, fontWeight: 700, fontSize: "0.8rem", whiteSpace: "nowrap" }}>{status.text}</span>}
      </div>
      <div className="text-secondary tabular-num" style={{ fontSize: "0.8rem", marginTop: 3 }}>
        {c.phone_display}{c.region_name ? ` · ${c.region_name}` : ""}
        {" · "}{c.days_of_week.slice().sort().map((d) => DAY_LABELS[d]).join("، ")}
      </div>
      {c.notes && <div className="text-secondary" style={{ fontSize: "0.8rem", marginTop: 3 }}>📝 {c.notes}</div>}
    </div>
  );
}

function ScheduleTab() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getReminderSchedule().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="text-secondary">جاري التحميل...</p>;

  if (data.customers.length === 0) {
    return (
      <div className="card text-secondary">
        ما في زباين إلهم أيام تسليم ثابتة. لتحديد أيام لزبون: افتح صفحة الزبون ← «منبّه التوصيل المعتاد» ← اختار الأيام.
      </div>
    );
  }

  const todayList = data.customers.filter((c) => c.days_of_week.includes(data.today_dow));
  const pendingToday = todayList.filter((c) => !c.today_order_status).length;

  // باقي أيام الأسبوع بالترتيب ابتداءً من بكرة
  const upcoming = [];
  for (let i = 1; i <= 6; i++) {
    const dow = (data.today_dow + i) % 7;
    const list = data.customers.filter((c) => c.days_of_week.includes(dow));
    if (list.length) upcoming.push({ dow, label: i === 1 ? `بكرة (${DAY_LABELS[dow]})` : DAY_LABELS[dow], list });
  }

  return (
    <>
      <div className="card" style={{ padding: 0, border: "2px solid var(--primary, #0094FF)" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>📅 مواعيد اليوم — {DAY_LABELS[data.today_dow]}</strong>
          <span className="tabular-num text-secondary" style={{ fontSize: "0.85rem" }}>
            {todayList.length} زبون{pendingToday > 0 ? ` · ${pendingToday} لسا ما انطلب` : ""}
          </span>
        </div>
        {todayList.length === 0 && <p className="text-secondary" style={{ padding: 14, margin: 0 }}>ما في مواعيد تسليم اليوم.</p>}
        {todayList.map((c) => (
          <ScheduleRow key={c.customer_id} c={c} highlight onOpen={() => navigate(`/customers/${c.customer_id}`)} />
        ))}
      </div>

      {upcoming.map((g) => (
        <div key={g.dow} className="card" style={{ padding: 0 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontWeight: 700 }}>
            {g.label} <span className="text-secondary tabular-num" style={{ fontWeight: 400 }}>· {g.list.length}</span>
          </div>
          {g.list.map((c) => (
            <ScheduleRow key={c.customer_id} c={c} onOpen={() => navigate(`/customers/${c.customer_id}`)} />
          ))}
        </div>
      ))}

      <p className="text-secondary" style={{ fontSize: "0.8rem" }}>
        كل يوم الساعة ٧ الصبح بيوصل إشعار لكل الحسابات بزباين اليوم. اضغط على أي زبون لتفتح صفحته وتسجّل طلبه.
      </p>
    </>
  );
}

function NotificationsTab({ notifications }) {
  const list = notifications ? notifications.filter((n) => n.type !== "REMINDER") : null;
  return (
    <>
      <DevicePushCard />
      <p className="text-secondary" style={{ marginBottom: 10, fontSize: "0.85rem" }}>تُحفظ الإشعارات هنا لمدة ٤٨ ساعة ثم تُحذف تلقائيًا.</p>
      <div className="card" style={{ padding: 0 }}>
        {!list && <p className="text-secondary" style={{ padding: 14 }}>جاري التحميل...</p>}
        {list && list.length === 0 && (
          <p className="text-secondary" style={{ padding: 14 }}>لا يوجد إشعارات خلال آخر ٤٨ ساعة.</p>
        )}
        {list && list.map((n) => (
          <div key={n.id} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontWeight: n.is_read ? 400 : 700 }}>
            <div>{n.message}</div>
            <div className="text-secondary tabular-num" style={{ fontSize: "0.75rem", marginTop: 4, fontWeight: 400 }}>
              {new Date(n.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Notifications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "schedule" ? "schedule" : "notifications";
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getNotifications()
      .then((list) => {
        setNotifications(list);
        return api.markNotificationsRead();
      })
      .catch((err) => setError(err.message));
  }, []);

  function setTab(next) {
    setSearchParams(next === "schedule" ? { tab: "schedule" } : {}, { replace: true });
  }

  const tabStyle = () => ({
    flex: 1,
    padding: "10px 6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: "0.95rem",
  });

  return (
    <div className="page">
      <h1 className="title-lg">الإشعارات والمواعيد</h1>
      {error && <div className="error-box">{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={tab === "notifications" ? "btn-primary" : "btn-secondary"} style={tabStyle()} onClick={() => setTab("notifications")}>
          <FiBell /> الإشعارات
        </button>
        <button className={tab === "schedule" ? "btn-primary" : "btn-secondary"} style={tabStyle()} onClick={() => setTab("schedule")}>
          <FiCalendar /> المواعيد
        </button>
      </div>

      {tab === "notifications" ? <NotificationsTab notifications={notifications} /> : <ScheduleTab />}
    </div>
  );
}
