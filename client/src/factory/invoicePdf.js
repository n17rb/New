// ============================================================
// فاتورة PDF على التلفون نفسه: منرسمها على canvas (المتصفح بيضبط العربي لحاله)،
// وبعدين منلفّ الصورة بملف PDF صغير — بدون أي مكتبة زيادة.
// ============================================================
const W = 1240, M = 72;
const C = { ink: "#102A43", muted: "#5E7085", line: "#E1E7EF", navy: "#0846B8", soft: "#EEF5FD", ok: "#1F9D55" };
const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("ar-JO-u-nu-latn", { weekday: "long", day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Amman" })} · ${d.toLocaleTimeString("ar-JO-u-nu-latn", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Amman" })}`;
};
const FONT = `-apple-system, "SF Arabic", "Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif`;

function loadImg(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("/")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function drawInvoice({ brand, invoice: inv, items, exchanges = [] }) {
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = 3600;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, cv.height);
  g.direction = "rtl"; g.textBaseline = "middle";
  const R = W - M, L = M;
  const text = (s, x, y, { size = 30, bold = false, color = C.ink, align = "right" } = {}) => {
    g.font = `${bold ? "700" : "400"} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.fillText(String(s ?? ""), x, y);
  };
  const hr = (y) => { g.fillStyle = C.line; g.fillRect(L, y, R - L, 2); };
  let y = M;

  // الشعار
  const logo = await loadImg(brand.logo);
  if (logo) {
    const k = Math.min(560 / logo.width, 150 / logo.height);
    const w = logo.width * k, h = logo.height * k;
    try { g.drawImage(logo, (W - w) / 2, y, w, h); } catch { /* صورة من دومين ثاني */ }
    y += h + 20;
  } else {
    text(brand.name, W / 2, y + 40, { size: 52, bold: true, color: C.navy, align: "center" }); y += 100;
  }
  if (brand.tagline) { text(brand.tagline, W / 2, y, { size: 26, color: C.muted, align: "center" }); y += 50; }

  // العنوان
  g.fillStyle = C.soft; g.fillRect(L, y, R - L, 110);
  text(`فاتورة رقم ${inv.id}`, R - 30, y + 55, { size: 44, bold: true, color: C.navy });
  text(when(inv.delivered_at), L + 30, y + 55, { size: 26, color: C.muted, align: "left" });
  y += 150;

  const kv = (k, v, opts = {}) => { text(k, R, y, { size: 30, color: C.muted }); text(v, L, y, { size: 30, bold: true, align: "left", ...opts }); y += 58; };
  kv("الزبون", inv.customer_name);
  if (inv.city) kv("المنطقة", inv.city);
  if (inv.driver_name) kv("سلّمها", `${inv.driver_name}${inv.vehicle_name ? ` · ${inv.vehicle_name}` : ""}`);
  kv("وقت التسليم", when(inv.delivered_at), { size: 26 });
  y += 14;

  // الجدول
  const col = { name: R - 24, qty: L + 560, price: L + 330, line: L + 24 };
  g.fillStyle = C.navy; g.fillRect(L, y, R - L, 70);
  for (const [k, s, a] of [["name", "الصنف", "right"], ["qty", "الكمية", "center"], ["price", "السعر", "center"], ["line", "المجموع", "left"]]) text(s, col[k], y + 35, { size: 28, bold: true, color: "#fff", align: a });
  y += 70;
  let zebra = false;
  const row = (cells, color = C.ink) => {
    if (zebra) { g.fillStyle = "#F7FAFD"; g.fillRect(L, y, R - L, 64); }
    zebra = !zebra;
    text(cells[0], col.name, y + 32, { size: 29, color });
    text(cells[1], col.qty, y + 32, { size: 29, color, align: "center" });
    text(cells[2], col.price, y + 32, { size: 29, color, align: "center" });
    text(cells[3], col.line, y + 32, { size: 29, color, align: "left", bold: true });
    y += 64;
  };
  for (const i of items) {
    const q = i.delivered_qty ?? i.qty;
    if (q > 0) row([i.name, q, money(i.price), money(i.line)]);
    const b = i.delivered_bonus ?? i.bonus_qty;
    if (b > 0) row([`بونص ${i.name}`, b, "ببلاش", "0.00"], C.ok);
  }
  for (const x of exchanges) row([`استبدال تالف ${x.name}`, x.qty, "ببلاش", "0.00"], "#5B3CC4");
  hr(y); y += 40;
  if (exchanges.length) {
    text(`أخذنا ${exchanges.map((x) => `${x.qty} ${x.name}`).join(" و")} تالف وأعطيناك بدالها جديد ببلاش`, R, y, { size: 26, color: "#5B3CC4" });
    y += 56;
  }

  // المجاميع
  g.fillStyle = C.soft; g.fillRect(L, y - 10, R - L, 84);
  text("المجموع", R - 24, y + 32, { size: 36, bold: true });
  text(`${money(inv.total)} د.أ`, L + 24, y + 32, { size: 40, bold: true, color: C.navy, align: "left" });
  y += 110;
  kv("المدفوع", money(inv.paid));
  kv("الباقي على الفاتورة", money(Math.max(0, inv.total - inv.paid)), Math.max(0, inv.total - inv.paid) > 0 ? { color: "#D64545" } : {});
  if (inv.balance_after != null) {
    const v = Number(inv.balance_after);
    kv("رصيد الحساب الكلي", v > 0.009 ? `${money(v)} عليك` : v < -0.009 ? `${money(-v)} إلك عنّا` : "0.00 ✓", v < -0.009 ? { color: C.ok } : {});
  }

  // التوقيع
  const sig = /^data:image/.test(inv.signature || "") ? await loadImg(inv.signature) : null;
  if (sig) {
    y += 10; text("توقيع المستلم", R, y, { size: 26, color: C.muted }); y += 20;
    const h = 170, w = Math.min(R - L, (sig.width / sig.height) * h);
    g.drawImage(sig, R - w, y, w, h); y += h + 20;
  }

  hr(y); y += 50;
  text(`${brand.name}${brand.phone ? ` · ${brand.phone}` : ""}`, W / 2, y, { size: 26, color: C.muted, align: "center" });
  y += M;

  const out = document.createElement("canvas");
  out.width = W; out.height = Math.ceil(y);
  out.getContext("2d").drawImage(cv, 0, 0);
  return out;
}

// ملف PDF من صفحة وحدة فيها صورة JPEG
function jpegToPdf(jpeg, wPx, hPx) {
  const pw = 595.28, ph = +(pw * (hPx / wPx)).toFixed(2);
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push("\nendobj\n"); };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${wPx} /Height ${hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  let x = "xref\n0 6\n0000000000 65535 f \n";
  for (let n = 1; n <= 5; n++) x += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function invoicePdf(data) {
  const cv = await drawInvoice(data);
  const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.9));
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  const pdf = jpegToPdf(jpeg, cv.width, cv.height);
  const name = `فاتورة-${data.invoice.id}-${(data.invoice.customer_name || "").replace(/[\\/:*?"<>|]/g, "")}.pdf`;
  return new File([pdf], name, { type: "application/pdf" });
}

// بيفتح قائمة المشاركة بالتلفون (واتساب، ...) والملف PDF جاهز؛ إذا ما بينفع بينزّل الملف
export async function shareInvoicePdf(data, { text } = {}) {
  const file = await invoicePdf(data);
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name, text });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = `invoice-${data.invoice.id}.pdf`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return "downloaded";
}
