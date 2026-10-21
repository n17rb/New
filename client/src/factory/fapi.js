import { request } from "../api.js";

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
  saveCustomer: (c) => (c.id ? put(`/customers/${c.id}`, c) : post("/customers", c)),
  deleteCustomer: (id) => del(`/customers/${id}`),
  customerLocation: (id, lat, lng) => post(`/customers/${id}/location`, { lat, lng }),
  payment: (id, b) => post(`/customers/${id}/payments`, b),
  adjust: (id, b) => post(`/customers/${id}/adjust`, b),
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
  driverToday: () => get("/driver/today"),
  driverCheck: (id, b) => post(`/driver/trips/${id}/check`, b),
  driverConfirmLoad: (id) => post(`/driver/trips/${id}/confirm-load`),
  driverStart: (id) => post(`/driver/trips/${id}/start`),
  driverReturn: (id, b) => post(`/driver/trips/${id}/return`, b),
  ping: (b) => post("/driver/ping", b),
  deliver: (id, b) => post(`/driver/orders/${id}/deliver`, b),
  fail: (id, b) => post(`/driver/orders/${id}/fail`, b),
  problem: (b) => post("/driver/problem", b),
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
  receiveReturns: (id, items) => post(`/stock/trips/${id}/returns`, { items }),
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
