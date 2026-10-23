import { useEffect, useState } from "react";
import { FiCheckCircle, FiLogIn } from "react-icons/fi";
import { api } from "../api.js";
import { money, balanceText } from "./Payroll.jsx";

const KIND_LABELS = { advance: "سحب", bonus: "مكافأة", deduction: "خصم", payment: "انصرف راتب" };

// الموظف: حسابي، دوامي هالشهر، وتسجيل الحضور
export default function MyPay() {
  const [me, setMe] = useState(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    api.payrollMe().then(setMe).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function checkIn() {
    setBusy(true);
    try {
      await api.payrollCheckIn();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (me === undefined) return <div className="page">{error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل...</p>}</div>;
  if (me === null) return <div className="page"><div className="card text-secondary">حسابك مش مربوط بملف موظف — اطلب من الإدارة تربطه من «الموظفين والرواتب».</div></div>;

  const b = balanceText(me.balance);
  const checkedIn = me.today_status === "present" || me.today_status === "half";

  return (
    <div className="page">
      <h1 className="title-lg">حسابي</h1>
      {error && <div className="error-box">{error}</div>}

      {checkedIn ? (
        <div className="success-box icon-row"><FiCheckCircle aria-hidden="true" /> سجّلت حضورك اليوم</div>
      ) : !me.can_check_in ? null : (
        <button className="btn-primary icon-row" style={{ justifyContent: "center", marginBottom: 12 }} disabled={busy} onClick={checkIn}>
          <FiLogIn aria-hidden="true" /> وصلت — سجّل حضوري اليوم
        </button>
      )}

      <div className="card" style={{ textAlign: "center" }}>
        <div className="text-secondary" style={{ fontSize: "0.85rem" }}>حسابك لهلّق</div>
        <div className="tabular-num" style={{ fontSize: "2rem", fontWeight: 800, color: b.color }}>{b.text}</div>
        <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
          هالشهر: {me.month.days.present} يوم دوام{me.month.days.half ? ` + ${me.month.days.half} نص` : ""} · مستحق {money(me.month.earned)}
        </div>
      </div>

      {me.recent_transactions?.length > 0 && (
        <>
          <div className="section-title">آخر الحركات</div>
          <div className="list-group">
            {me.recent_transactions.map((t) => (
              <div key={t.id} className="list-row" style={{ cursor: "default" }}>
                <span className="list-text">
                  <span className="list-title">{KIND_LABELS[t.kind]}</span>
                  <div className="list-sub">{t.date}{t.note ? ` · ${t.note}` : ""}</div>
                </span>
                <strong className="tabular-num">{Number(t.amount).toFixed(2)}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
