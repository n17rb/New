import { useEffect, useRef, useState } from "react";
import { FiSend, FiZap, FiUsers, FiTruck, FiCamera, FiDollarSign, FiBox, FiCheck, FiMessageCircle } from "react-icons/fi";
import { useFx, Sheet, money } from "./ui.jsx";
import { fapi } from "./fapi.js";
import { SUPPORT_PHONE } from "../shop.js";


// ============================================================
// المساعد: الموظف بيسأل بالعامية وبيرد عليه بخطوات مع شكل الزر، وبيورجيه وين يكبس
// ============================================================

const mk = (t, cls = "") => ({ t, cls });
const QA = [
  {
    k: /رحل|خصص|وزّع|وزع|سيارة معينة|ابني/,
    q: "كيف بوزّع طلبات على سيارة معينة؟",
    who: (c) => c.can("f_dispatch", "edit"),
    a: () => ({
      t: "مثلًا طلب بالرمثا وطلب بالطرّة لنفس السيارة:",
      steps: [
        ["افتح «الطلبات» وعلّم على الطلبات اللي بدك إياها", [mk("☐ بقالة الرمثا"), mk("☐ سوبرماركت الطرّة")]],
        ["تحت بيطلع زر «رحلة جديدة» — اكبسه", [mk("رحلة جديدة", "pri")]],
        ["اختار السيارة، واكبس «رتّب من الأقرب للأبعد» أو رتّبهم بالأسهم", [mk("سيارة 6 · أحمد"), mk("رتّب من الأقرب للأبعد")]],
        ["اكبس «اعتمد»، وبعدين ابعت للزباين موعد الوصول على واتساب", [mk("اعتمد الرحلة", "pri"), mk("ابعت على واتساب")]],
      ],
      go: ["/f/orders", "orders-list"],
    }),
  },
  {
    k: /نقل|انقل|سائق ثاني|شوفير ثاني|غيّر السائق|غير السائق/,
    q: "كيف بنقل طلب من سائق لسائق ثاني؟",
    who: (c) => c.can("f_dispatch", "edit"),
    a: () => ({
      t: "بثلاث خطوات:",
      steps: [
        ["افتح «الطلبات» وانزل لـ«على السيارات»", [mk("الطلبات")]],
        ["جنب الطلب اكبس «نقل»", [mk("نقل")]],
        ["اختار السيارة الجديدة والسبب واكبس «انقل»", [mk("سيارة 4 · يزن"), mk("انقل", "pri")]],
      ],
      go: ["/f/orders", "assigned-list"],
    }),
  },
  {
    k: /تأخ|تاخ|تعطل|عطل بالسيارة|اعتذ/,
    q: "سيارة تعطلت — كيف ببلّغ الزباين إنه الطلب رح يتأخر؟",
    who: (c) => c.can("f_dispatch", "edit"),
    a: () => ({
      t: "من شاشة الرحلات:",
      steps: [
        ["افتح «الرحلات»", [mk("الرحلات")]],
        ["على رحلة السيارة اكبس «تأخير»", [mk("تأخير", "red")]],
        ["اختار السبب والموعد الجديد", [mk("عطل بالسيارة"), mk("بكرا الصبح")]],
        ["اكبس «جهّز الرسائل» وابعت كل وحدة على واتساب", [mk("ابعت على واتساب")]],
      ],
      go: ["/f/trips", "trips-list"],
    }),
  },
  {
    k: /ديزل|مصروف|مصاريف|بنشر|فاتورة/,
    q: "كيف بسجّل مصروف ديزل؟",
    who: (c) => c.can("f_drive", "edit"),
    a: () => ({
      t: "من شاشة «رحلتي»:",
      steps: [
        ["اكبس «مصروف»", [mk("مصروف", "pri")]],
        ["اختار «ديزل» واكتب المبلغ واللترات", [mk("ديزل"), mk("20 دينار")]],
        ["صوّر الفاتورة والعداد", [mk("صوّر الفاتورة"), mk("صوّر العداد")]],
        ["اكبس «ابعت للإدارة» — بينخصم من الكاش اللي بتسلّمه", [mk("ابعت للإدارة", "pri")]],
      ],
      go: ["/f/drive", "expense-btn"],
    }),
  },
  {
    k: /سلّم|سلم|توقيع|وقع/,
    q: "كيف بسلّم طلب للزبون؟",
    who: (c) => c.can("f_drive", "edit"),
    a: () => ({
      t: "عند الزبون:",
      steps: [
        ["بشاشة «رحلتي» على وقفة الزبون اكبس «تسليم»", [mk("تسليم", "pri")]],
        ["تأكد من الكمية، واكتب قديش دفع كاش", [mk("300 كرتونة"), mk("كاش 300")]],
        ["خلي الزبون يوقّع بإصبعه", [mk("توقيع")]],
        ["اكبس «أكّد التسليم» وابعتله الفاتورة على واتساب", [mk("أكّد التسليم", "pri")]],
      ],
      go: ["/f/drive", "stops"],
    }),
  },
  {
    k: /كاش|حساب.*سائق|يسل|تسوية/,
    q: "قديش لازم يسلّم كل سائق اليوم؟",
    who: (c) => c.can("f_money"),
    dyn: async () => {
      const list = await fapi.drivers();
      const rows = list.filter((d) => d.cash_now > 0);
      return {
        t: rows.length ? rows.map((d) => `• ${d.full_name}: ${money(d.cash_now)} د.أ`).join("\n") : "ولا سائق معه كاش هلأ.",
        go: ["/f/money", "settle-list"],
      };
    },
  },
  {
    k: /دين|ديون|مين عليه/,
    q: "مين عليه ديون؟",
    who: (c) => c.can("f_money") || c.can("f_customers"),
    dyn: async () => {
      const d = await fapi.debts();
      return {
        t: `المجموع ${money(d.total)} د.أ.\n${d.customers.slice(0, 5).map((c) => `• ${c.name}: ${money(c.balance)} (من ${c.days} يوم)`).join("\n")}`,
        go: ["/f/money?tab=debts", null],
      };
    },
  },
  {
    k: /زبون جديد|ضيف زبون|اضيف زبون|احفظ زبون|أحفظ زبون/,
    q: "كيف بضيف زبون جديد؟",
    who: () => true,
    a: () => ({
      t: "من شاشة الزباين:",
      steps: [
        ["افتح «المزيد» ← «الزباين»", [mk("الزباين")]],
        ["اكبس «زبون جديد»", [mk("+ زبون جديد", "pri")]],
        ["اكتب اسم المحل والتلفون والمدينة، واختار الخط", [mk("بقالة الأمل"), mk("إربد")]],
        ["إذا إنت عنده هلأ اكبس «موقعي هلأ» عشان ينحفظ موقعه", [mk("موقعي هلأ")]],
      ],
      go: ["/f/customers", "new-customer"],
    }),
  },
  {
    k: /طلب جديد|سجل طلب|سجّل طلب|اضيف طلب/,
    q: "كيف بسجّل طلب جديد؟",
    who: (c) => c.can("f_orders", "edit") || c.can("f_dispatch", "edit"),
    a: () => ({
      t: "من «الطلبات»:",
      steps: [
        ["اكبس «طلب جديد»", [mk("+ طلب جديد", "pri")]],
        ["اختار الزبون، والمنتج والعدد", [mk("شرنك 600 مل"), mk("300")]],
        ["اكبس «سجّل»، وابعت للزبون تأكيد على واتساب", [mk("سجّل الطلب", "pri")]],
      ],
      go: ["/f/orders", "new-order"],
    }),
  },
  {
    k: /إنتاج|انتاج|كم انتجنا|سجل انتاج/,
    q: "كيف بسجّل الإنتاج؟",
    who: (c) => c.can("f_production", "edit"),
    a: () => ({
      t: "من «الإنتاج»:",
      steps: [
        ["اكبس «سجّل إنتاج»", [mk("سجّل إنتاج", "pri")]],
        ["اختار المنتج والوردية واكتب عدد الكراتين", [mk("كاس رقم 1"), mk("صبحي"), mk("400")]],
        ["المواد الخام بتنخصم لحالها", []],
      ],
      go: ["/f/stock?tab=prod", "prod-btn"],
    }),
  },
  {
    k: /تالف|توالف|مضروب/,
    q: "كيف بسجّل تالف؟",
    who: (c) => c.can("f_stock", "edit") || c.can("f_production", "edit"),
    a: () => ({
      t: "من «المستودع»:",
      steps: [
        ["اكبس «تالف»", [mk("تالف", "red")]],
        ["اختار وين صار: المستودع، السيارة، أو الماكنة", [mk("المستودع"), mk("الماكنة")]],
        ["اكتب العدد والسبب وصوّر", [mk("12 كرتونة"), mk("صوّر")]],
      ],
      go: ["/f/stock", "damage-btn"],
    }),
  },
  {
    k: /حمول|تحميل|مرتجع/,
    q: "كيف بحمّل سيارة وبستلم المرتجع؟",
    who: (c) => c.can("f_stock", "edit"),
    a: () => ({
      t: "من «المستودع» ← «التحميل»:",
      steps: [
        ["كل سيارة إلها قائمة باللي لازم يطلع عليها", [mk("سيارة 6 · 600 كرتونة")]],
        ["بعد ما تعد الكراتين اكبس «أكّد التحميل»", [mk("أكّد التحميل", "pri")]],
        ["لما ترجع السيارة: عدّ الراجع واكبس «استلمت المرتجع»", [mk("استلمت المرتجع", "pri")]],
      ],
      go: ["/f/stock?tab=load", null],
    }),
  },
  {
    k: /موظف|صلاح|حساب للسائق|يوزر|مستخدم/,
    q: "كيف بضيف موظف وبعطيه صلاحيات؟",
    who: (c) => c.isOwner,
    a: () => ({
      t: "من «المزيد» ← «الموظفين والصلاحيات»:",
      steps: [
        ["اكبس «إضافة موظف»", [mk("إضافة موظف", "pri")]],
        ["اختار دوره: سائق، مسؤول حركة، أمين مستودع، محاسب...", [mk("سائق"), mk("مسؤول الحركة")]],
        ["اعطيه اسم مستخدم وكلمة سر، وابعتله إياهم", []],
        ["إذا سائق: من «الإعدادات» ← «السيارات» اربطه بسيارته", [mk("سيارة 6")]],
      ],
      go: ["/users", null],
    }),
  },
  {
    k: /وضع|اليوم|ملخص|كيف المصنع/,
    q: "شو وضع المصنع اليوم؟",
    who: (c) => c.can("f_home"),
    dyn: async () => {
      const h = await fapi.home();
      return {
        t: `إنتاج اليوم ${h.production} كرتونة.\nمبيعات ${money(h.sales.total)} د.أ (${h.sales.orders} طلب).\nكاش مع السائقين ${money(h.cash_with_drivers)}.\nتنبيهات مفتوحة: ${h.alerts.length}.`,
        go: ["/", null],
      };
    },
  },
];

export function HelpSheet({ onClose }) {
  const fx = useFx();
  const mine = QA.filter((x) => x.who(fx));
  const [chat, setChat] = useState([{ who: "ai", body: { t: `أهلاً ${fx.user.full_name?.split(" ")[0] || ""}. اسألني كيف تعمل أي إشي بالنظام وبورجيك خطوة بخطوة.`, chips: true } }]);
  const [text, setText] = useState("");
  const logRef = useRef(null);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [chat]);

  async function ask(q) {
    if (!q.trim()) return;
    setText("");
    const hit = mine.find((x) => x.k.test(q)) || QA.find((x) => x.k.test(q) && x.who(fx));
    let body;
    if (!hit) body = { t: "ما فهمت عليك منيح. جرّب تسألها بطريقة ثانية، أو اختار سؤال من هدول:", chips: true, support: true };
    else if (hit.dyn) {
      try { body = await hit.dyn(); } catch (e) { body = { t: e.message }; }
    } else body = hit.a();
    setChat((c) => [...c, { who: "me", text: q }, { who: "ai", body }]);
  }

  return (
    <Sheet title="المساعد" onClose={onClose}>
      <div className="fx-chat" ref={logRef}>
        {chat.map((m, i) =>
          m.who === "me" ? (
            <div key={i} className="fx-me">{m.text}</div>
          ) : (
            <div key={i} className="fx-ai">
              <p style={{ margin: 0, whiteSpace: "pre-line" }}>{m.body.t}</p>
              {m.body.steps && (
                <ol>
                  {m.body.steps.map(([s, shots], j) => (
                    <li key={j}>
                      {s}
                      {shots.length > 0 && (
                        <div className="fx-shot">
                          {shots.map((x, k) => <span key={k} className={`fx-mk ${x.cls}`}>{x.t}</span>)}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {m.body.go && <button className="fx-btn pri sm" onClick={() => fx.show(m.body.go[0], m.body.go[1])}>ورجيني وين</button>}
              {m.body.chips && (
                <div className="fx-chips">
                  {mine.map((x) => <button key={x.q} className="fx-chip" onClick={() => ask(x.q)}>{x.q}</button>)}
                </div>
              )}
              {m.body.support && (
                <a className="fx-btn wa sm" href={`https://wa.me/962${SUPPORT_PHONE.slice(1)}?text=${encodeURIComponent("مرحبا، عندي سؤال عن نظام المصنع: ")}`} target="_blank" rel="noreferrer">
                  <FiMessageCircle /> اسأل دعم موج على واتساب
                </a>
              )}
            </div>
          )
        )}
      </div>
      <form className="fx-row" style={{ marginTop: 12, flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input className="fx-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلًا: كيف بنقل طلب لسائق ثاني؟" />
        <button className="fx-btn pri" aria-label="اسأل"><FiSend /></button>
      </form>
    </Sheet>
  );
}

// ---------- الجولة التعريفية: أول مرة بيفتح فيها كل موظف ----------
function slidesFor(fx) {
  const b = fx.shop?.brand || {};
  const logo = b.logo ? <img src={b.logo} alt="" /> : <FiZap />;
  const first = { ill: logo, h: `أهلاً بنظام ${b.name || "المصنع"}`, p: "كل شغل المصنع صار هون: الطلبات، السيارات، المستودع، والحسابات. كل موظف بيشوف شغله بس." };
  const helpSlide = { ill: <FiZap />, h: "علقت؟ اسأل المساعد", p: "زر «المساعد» تحت بيجاوبك بالعامية، بخطوات وصور، وبيأشرلك وين تكبس. وإذا ما زبطت، بيوصلك بالدعم." };
  if (fx.isOwner) {
    return [
      first,
      { ill: <FiUsers />, h: "كل موظف إله شاشته", p: "السائق بيشوف رحلته، مسؤول الحركة بيوزّع الطلبات، أمين المستودع بيحمّل ويستلم المرتجع، والمحاسب بيستلم الكاش. إنت بتشوف كل إشي." },
      { ill: <FiCheck />, h: "بنجهّز المصنع سوا", p: "معالج البداية بيمشّيك خطوة خطوة: الشعار، المنتجات، السيارات، الخطوط، الموظفين، والزباين. كل خطوة دقيقتين." },
      helpSlide,
    ];
  }
  if (fx.can("f_drive", "edit") && !fx.can("f_dispatch")) {
    return [
      first,
      { ill: <FiCamera />, h: "قبل ما تطلع", p: "صوّر العداد ومؤشر الديزل، وأكّد الحمولة. بعدها بتبلش الرحلة والزباين بيوصلهم إنك بالطريق." },
      { ill: <FiTruck />, h: "عند كل زبون", p: "اكبس «تسليم»، اكتب قديش دفع، وخليه يوقّع. الفاتورة بتوصله على واتساب." },
      { ill: <FiDollarSign />, h: "آخر اليوم", p: "سجّل أي مصروف بصورة الفاتورة. النظام بيحسبلك قديش تسلّم بالزبط: المحصّل ناقص المصاريف." },
      helpSlide,
    ];
  }
  if (fx.can("f_dispatch")) {
    return [
      first,
      { ill: <FiTruck />, h: "وزّع الطلبات على السيارات", p: "علّم على الطلبات، اختار السيارة، ورتّب الوقفات. السائق بيوصله الترتيب فورًا." },
      { ill: <FiMessageCircle />, h: "الزبون دايمًا بيعرف", p: "بعد كل خطوة بتطلعلك رسالة جاهزة للزبون: موعد الوصول، التأخير وسببه، أو الفاتورة. بتبعتها بكبسة على واتساب." },
      helpSlide,
    ];
  }
  return [
    first,
    { ill: <FiBox />, h: "شغلك بسيط", p: "كل شاشة إلها شغلة وحدة، وأول مرة بتفتحها بيطلعلك شرح قصير فوقها." },
    helpSlide,
  ];
}

export function Tour({ step, setStep, onDone }) {
  const fx = useFx();
  const slides = slidesFor(fx);
  const s = slides[step] || slides[0];
  const last = step >= slides.length - 1;
  return (
    <div className="fx-tour">
      <div className="fx-tour-card" role="dialog" aria-modal="true" aria-label={s.h}>
        <div className="ill">{s.ill}</div>
        <h3>{s.h}</h3>
        <p>{s.p}</p>
        <div className="fx-dots">{slides.map((_, i) => <i key={i} className={i === step ? "on" : ""} />)}</div>
        <div className="fx-row" style={{ justifyContent: "space-between" }}>
          <button className="fx-link" onClick={onDone}>تخطّي</button>
          <button className="fx-btn pri" onClick={() => (last ? onDone() : setStep(step + 1))}>{last ? "يلا نبلش" : "التالي"}</button>
        </div>
      </div>
    </div>
  );
}

