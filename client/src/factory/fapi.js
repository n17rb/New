import { request, peek } from "../api.js";

// ============================================================
// موج للمصانع — طلبات السيرفر
// ============================================================
const F = "/factory";
const qs = (o = {}) => {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
  return s ? `?${s}` : "";
};
const post = (path, body) => request(F + path, { method: "POST", body: body || {} });
const put = (path, body) => request(F + path, { method: "PUT", body: body || {} });
const del = (path) => request(F + path, { method: "DELETE" });
const get = (path) => request(F + path);

export const fapi = {
  bootstrap: () => get("/bootstrap"),
  home: () => get("/home"),
  live: () => get("/live"),
  density: () => get("/density"),
  invoices: (p) => get(`/invoices${qs(p)}`),
  recurring: (p) => get(`/recurring${qs(p)}`),
  saveRecurring: (r) => (r.id ? put(`/recurring/${r.id}`, r) : post("/recurring", r)),
  deleteRecurring: (id) => del(`/recurring/${id}`),
  alerts: () => get("/alerts"),
  alertsCount: () => get("/alerts/count"),
  closeAlert: (id) => post(`/alerts/${id}/close`),

  // إعدادات
  saveProduct: (p) => (p.id ? put(`/products/${p.id}`, p) : post("/products", p)),
  priceFixPreview: (q) => get(`/prices/fix-preview?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== "" && v != null)).toString()}`),
  priceFix: (b) => post("/prices/fix", b),
  productImage: (id, file) => {
    const form = new FormData();
    form.append("photo", file);
    return request(`${F}/products/${id}/image`, { method: "POST", body: form, isFormData: true });
  },
  removeProductImage: (id) => del(`/products/${id}/image`),
  brandFor: (id) => request(`/public/f/brand/${Number(id)}`),
  saveRecipe: (id, items) => put(`/products/${id}/recipe`, { items }),
  saveBonus: (b) => (b.id ? put(`/bonus-rules/${b.id}`, b) : post("/bonus-rules", b)),
  deleteBonus: (id) => del(`/bonus-rules/${id}`),
  saveVehicle: (v) => (v.id ? put(`/vehicles/${v.id}`, v) : post("/vehicles", v)),
  saveLine: (l) => (l.id ? put(`/lines/${l.id}`, l) : post("/lines", l)),
  deleteLine: (id) => del(`/lines/${id}`),
  saveMachine: (m) => (m.id ? put(`/machines/${m.id}`, m) : post("/machines", m)),
  saveMaterial: (m) => (m.id ? put(`/materials/${m.id}`, m) : post("/materials", m)),
  saveSettings: (b) => put("/settings", b),
  uploadLogo: (file) => {
    const form = new FormData();
    form.append("photo", file);
    return request(`${F}/settings/logo`, { method: "POST", body: form, isFormData: true });
  },
  uploadIcon: (file) => {
    const form = new FormData();
    form.append("photo", file);
    return request(`${F}/settings/icon`, { method: "POST", body: form, isFormData: true });
  },
  upload: (file, kind = "f") => {
    const form = new FormData();
    form.append("photo", file);
    return request(`${F}/upload?kind=${kind}`, { method: "POST", body: form, isFormData: true });
  },

  // الزباين
  customers: (p) => get(`/customers${qs(p)}`),
  customer: (id) => get(`/customers/${id}`),
  nextCustomerSeq: () => get("/customers-next-seq"),
  resolveMapLink: (url) => post("/customers-resolve-link", { url }),
  customerRegion: (lat, lng) => post("/customers-region", { lat, lng }),
  saveCustomer: (c) => (c.id ? put(`/customers/${c.id}`, c) : post("/customers", c)),
  deleteCustomer: (id) => del(`/customers/${id}`),
  customerLocation: (id, lat, lng) => post(`/customers/${id}/location`, { lat, lng }),
  driverNoLocation: () => get("/driver/no-location"),
  setCustomersLine: (b) => post("/customers/set-line", b),
  orderFirst: (id) => post(`/orders/${id}/first`),
  productionLog: (from, to) => get(`/stock/production-log?from=${from}&to=${to}`),
  cashCats: () => get("/books/cash-cats"),
  journal: (from, to) => get(`/books/journal?from=${from}&to=${to}`),
  saveCashCats: (kind, list) => put(`/books/cash-cats/${kind}`, { list }),
  orderUnassign: (id, reason) => post(`/orders/${id}/unassign`, { reason }),
  payment: (id, b) => post(`/customers/${id}/payments`, b),
  adjust: (id, b) => post(`/customers/${id}/adjust`, b),
  customerDebt: (id, b) => post(`/customers/${id}/debt`, b),
  trackLink: (id) => post(`/customers/${id}/track-link`),
  messages: (p) => get(`/messages${qs(p)}`),
  messageSent: (id) => post(`/messages/${id}/sent`),
  sendMessage: (b) => post("/messages", b),

  // الطلبات والرحلات
  orders: (p) => get(`/orders${qs(p)}`),
  createOrder: (b) => post("/orders", b),
  updateOrder: (id, b) => put(`/orders/${id}`, b),
  cancelOrder: (id, reason) => post(`/orders/${id}/cancel`, { reason }),
  reopenOrder: (id, due_date) => post(`/orders/${id}/reopen`, { due_date }),
  transfer: (id, b) => post(`/orders/${id}/transfer`, b),
  trips: (p) => get(`/trips${qs(p)}`),
  trip: (id) => get(`/trips/${id}`),
  previewTrip: (b) => post("/trips/preview", b),
  createTrip: (b) => post("/trips", b),
  updateTrip: (id, b) => put(`/trips/${id}`, b),
  reorderStops: (id, b) => put(`/trips/${id}/stops`, b),
  cancelTrip: (id) => post(`/trips/${id}/cancel`),
  delayTrip: (id, b) => post(`/trips/${id}/delay`, b),

  // السائق
  // بدون شبكة: آخر نسخة محفوظة من رحلتي
  driverToday: () => get("/driver/today").catch((e) => { const c = e.offline ? peek(`${F}/driver/today`) : undefined; if (c) return { ...c, offline: true }; throw e; }),
  jard: (o) => get(`/jard${qs(o)}`),
  orderDetail: (id) => get(`/orders/${id}/detail`),
  correctInvoice: (id, b) => post(`/orders/${id}/correct`, b),
  myJard: (o) => get(`/driver/jard${qs(o)}`),
  jardSettle: (b) => post("/jard/settle", b),
  loadEdit: (id, b) => post(`/trips/${id}/load-edit`, b),
  driverCheck: (id, b) => post(`/driver/trips/${id}/check`, b),
  driverConfirmLoad: (id) => post(`/driver/trips/${id}/confirm-load`),
  driverStart: (id, b) => post(`/driver/trips/${id}/start`, b),
  ackLoad: (id, b) => post(`/driver/trips/${id}/ack-load`, b),
  notifyLoaded: (id) => post(`/trips/${id}/notify-loaded`),
  salvageReceive: (id, qty) => post(`/stock/salvage/${id}/receive`, { qty }),
  driverGo: (id, b) => post(`/driver/orders/${id}/go`, b),
  driverResort: (id, b) => post(`/driver/trips/${id}/resort`, b),
  driverReturn: (id, b) => post(`/driver/trips/${id}/return`, b),
  ping: (b) => post("/driver/ping", b),
  deliver: (id, b) => post(`/driver/orders/${id}/deliver`, b),
  fail: (id, b) => post(`/driver/orders/${id}/fail`, b),
  problem: (b) => post("/driver/problem", b),
  salesStart: (b) => post("/driver/sales/start", b),
  salesLoad: (id, b) => post(`/driver/sales/${id}/load`, b),
  salesSell: (id, b) => post(`/driver/sales/${id}/sell`, b),
  driverShops: (o) => get(`/driver/shops${qs(o)}`),
  driverPrices: (cid) => get(`/driver/prices${qs({ customer_id: cid })}`),
  problemResolve: (id, b) => post(`/driver/problem/${id}/resolve`, b || {}),
  tripFixed: (id) => post(`/trips/${id}/fixed`),
  myExpenses: () => get("/driver/expenses"),
  addExpense: (b) => post("/driver/expenses", b),
  myAccount: () => get("/driver/account"),

  // المستودع والإنتاج
  stock: () => get("/stock"),
  moves: (p) => get(`/stock/moves${qs(p)}`),
  production: (b) => post("/stock/production", b),
  damage: (b) => post("/stock/damage", b),
  count: (items) => post("/stock/count", { items }),
  adjustStock: (b) => post("/stock/adjust", b),
  loading: () => get("/stock/loading"),
  confirmLoad: (id, extra) => post(`/stock/trips/${id}/load`, { extra }),
  receiveReturns: (id, items, salvage) => post(`/stock/trips/${id}/returns`, { items, salvage }),
  salvage: () => get("/stock/salvage"),
  fixSalvage: (id, qty) => post(`/stock/salvage/${id}/fix`, { qty }),

  // صيانة السيارات
  maint: () => get("/maint"),
  addMaint: (b) => post("/maint", b),
  setOdo: (vehicle_id, odo) => post("/maint/odo", { vehicle_id, odo }),
  delMaint: (id) => del(`/maint/${id}`),
  maintReport: (year) => get(`/maint/report${qs({ year })}`),

  // مستودع المواد وقطع الغيار
  store: () => get("/store"),
  storeAdd: (b) => post("/store/items", b),
  storeEdit: (id, b) => put(`/store/items/${id}`, b),
  storeReceive: (b) => post("/store/receive", b),
  storeTake: (b) => post("/store/take", b),
  storeAdjust: (id, b) => post(`/store/items/${id}/adjust`, b),
  storeCount: (items) => post("/store/count", { items }),
  storeItemMoves: (id) => get(`/store/items/${id}/moves`),
  storeMoves: (p) => get(`/store/moves${qs(p)}`),
  addSite: (b) => post("/store/sites", b),
  editSite: (id, b) => put(`/store/sites/${id}`, b),
  addPline: (b) => post("/store/lines", b),
  editPline: (id, b) => put(`/store/lines/${id}`, b),
  deletePline: (id) => del(`/store/lines/${id}`),
  setMachineSite: (id, b) => put(`/store/machines/${id}`, b),
  storeStaff: () => get("/store/staff"),
  storeStarter: (b) => post("/store/starter", b),

  // خط الإنتاج: فحوصات، فلاتر، تالف
  line: () => get("/line"),
  lineCheck: (id, b) => post(`/line/${id}/check`, b),
  lineSheet: (id, date) => get(`/line/${id}/sheet${qs({ date })}`),
  addFilter: (b) => post("/line/filters", b),
  editFilter: (id, b) => put(`/line/filters/${id}`, b),
  filterChange: (id, b) => post(`/line/filters/${id}/change`, b),
  lineWaste: (b) => post("/line/waste", b),
  lineSettings: (id, b) => put(`/line/${id}/settings`, b),
  workHours: (userId, b) => put(`/line/hours/${userId}`, b),
  linePhoto: (id, photo_url) => put(`/line/${id}/photo`, { photo_url }),

  // الدفاتر: الشركات، إعادة التدوير، الصندوق، التسليم، الملخّص
  partners: () => get("/books/partners"),
  partner: (id) => get(`/books/partners/${id}`),
  addPartner: (b) => post("/books/partners", b),
  editPartner: (id, b) => put(`/books/partners/${id}`, b),
  partnerEntry: (id, b) => post(`/books/partners/${id}/entries`, b),
  partnerMessage: (id) => get(`/books/partners/${id}/message`),
  agreementTemplates: () => get("/books/agreement-templates"),
  saveAgreementTemplate: (kind, body) => put(`/books/agreement-templates/${kind}`, { body }),
  addAgreement: (partnerId, b) => post(`/books/partners/${partnerId}/agreements`, b),
  editAgreement: (id, b) => put(`/books/agreements/${id}`, b),
  delAgreement: (id) => del(`/books/agreements/${id}`),
  entryFile: (id, file_url) => post(`/books/entries/${id}/file`, { file_url }),
  recycle: () => get("/books/recycle"),
  addRecycle: (b) => post("/books/recycle", b),
  recycleReceive: (id, amount) => post(`/books/recycle/${id}/receive`, { amount }),
  cashbook: (p) => get(`/books/cash${qs(p)}`),
  addCash: (b) => post("/books/cash", b),
  delCash: (id) => del(`/books/cash/${id}`),
  handovers: () => get("/books/handover"),
  addHandover: (b) => post("/books/handover", b),
  confirmHandover: (id, signature) => post(`/books/handover/${id}/confirm`, { signature }),
  rejectHandover: (id) => post(`/books/handover/${id}/reject`),
  booksSummary: (p) => get(`/books/summary${qs(p)}`),
  meters: () => get("/books/meters"),
  addMeter: (b) => post("/books/meters", b),
  editMeter: (id, b) => put(`/books/meters/${id}`, b),
  meterEntry: (id, b) => post(`/books/meters/${id}/entries`, b),
  meterPaid: (id) => post(`/books/meter-entries/${id}/paid`),

  // التأجيل
  postpones: () => get("/orders/postpones"),
  confirmPostpone: (id, due_date) => post(`/orders/${id}/postpone/confirm`, { due_date }),
  rejectPostpone: (id) => post(`/orders/${id}/postpone/reject`),
  receiveMaterial: (id, b) => post(`/stock/materials/${id}/receive`, b),
  adjustMaterial: (id, b) => post(`/stock/materials/${id}/adjust`, b),
  downtime: () => get("/stock/downtime"),
  startDowntime: (b) => post("/stock/downtime", b),
  endDowntime: (id, b) => post(`/stock/downtime/${id}/end`, b),

  // الحسابات
  settlements: () => get("/money/settlements"),
  receiveCash: (id, handed) => post(`/money/trips/${id}/cash`, { handed }),
  expenses: (status) => get(`/money/expenses${qs({ status })}`),
  approveExpense: (id) => post(`/money/expenses/${id}/approve`),
  rejectExpense: (id) => post(`/money/expenses/${id}/reject`),
  debts: () => get("/money/debts"),
  remindDebts: (customer_ids) => post("/money/debts/remind", { customer_ids }),
  drivers: () => get("/money/drivers"),
  driverLedger: (id) => get(`/money/drivers/${id}`),
  driverLedgerAdd: (id, b) => post(`/money/drivers/${id}/ledger`, b),

  reports: (p) => get(`/reports${qs(p)}`),
  sampleInfo: () => get("/sample"),
  clearSample: () => post("/sample/remove", { confirm: "امسح" }),

  // صفحات الزبون العامة
  track: (token) => request(`/public/f/track/${encodeURIComponent(token)}`),
  invoice: (token) => request(`/public/f/invoice/${encodeURIComponent(token)}`),
};
