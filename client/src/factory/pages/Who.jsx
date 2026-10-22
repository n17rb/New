import { money } from "../ui.jsx";

// مين الزبون: صورة المحل، الاسم، المسؤول، العنوان، الدين والملاحظات
export function Who({ o, big }) {
  const bal = Number(o.customer_balance) || 0;
  return (
    <div className={`fx-who ${big ? "big" : ""}`}>
      {o.photo_url
        ? (big
          ? <a href={o.photo_url} target="_blank" rel="noreferrer" className="ph"><img src={o.photo_url} alt={`محل ${o.customer_name}`} /></a>
          : <span className="ph"><img src={o.photo_url} alt={`محل ${o.customer_name}`} /></span>)
        : <span className="ph none">{(o.customer_name || "؟").trim()[0]}</span>}
      <div className="tx">
        <b className="nm">{o.customer_name}{o.seq_no ? <small> #{o.seq_no}</small> : null}</b>
        {o.contact_name && <span>👤 {o.contact_name}</span>}
        {(o.city || o.address) && <span>📍 {[o.city, o.address].filter(Boolean).join(" · ")}</span>}
        {o.phone && <span dir="ltr" style={{ textAlign: "end" }}>{o.phone} ☎</span>}
        {bal > 0 && <span className="debt">⚠️ عليه دين قديم <b>{money(bal)}</b> دينار — ذكّره بلطف</span>}
        {o.customer_notes && <span className="note">📝 {o.customer_notes}</span>}
        {o.notes && o.notes !== "بيع مندوب" && <span className="note">📦 {o.notes}</span>}
      </div>
    </div>
  );
}

export const navUrl = (o) => `https://www.google.com/maps/dir/?api=1&destination=${o.lat ? `${o.lat},${o.lng}` : encodeURIComponent(`${o.city || ""} الأردن`)}`;
