const BASE = "https://new-mha6.onrender.com/api";
export const API_ORIGIN = BASE.replace(/\/api$/, "");

function getToken() {
  return localStorage.getItem("token");
}

// نسخة محفوظة من آخر رد لكل صفحة مهمة — بتظهر فورًا وبعدين بتتحدّث (التطبيق بيفتح أسرع)
const CACHEABLE = [/^\/factory\/driver\/today$/, /^\/dashboard$/, /^\/cash\/current$/, /^\/cash\/insights$/, /^\/forecast$/, /^\/customers(\?|$)/, /^\/orders(\?|$)/, /^\/trips\/mine$/, /^\/swot$/];
const memCache = new Map();
function cacheKey(path) {
  try {
    const u = JSON.parse(localStorage.getItem("user") || "null");
    const s = JSON.parse(localStorage.getItem("shop") || "null");
    return `c:${s?.id ?? 0}:${u?.id ?? 0}:${path}`;
  } catch {
    return `c:0:0:${path}`;
  }
}
export function peek(path) {
  const k = cacheKey(path);
  if (memCache.has(k)) return memCache.get(k);
  try {
    const raw = localStorage.getItem(k);
    if (raw) { const v = JSON.parse(raw); memCache.set(k, v); return v; }
  } catch { /* تجاهل */ }
  return undefined;
}
function remember(path, data) {
  if (!CACHEABLE.some((re) => re.test(path))) return;
  const k = cacheKey(path);
  memCache.set(k, data);
  try {
    const raw = JSON.stringify(data);
    if (raw.length < 350000) localStorage.setItem(k, raw);
  } catch { /* المساحة خلصت — بنكتفي بالذاكرة */ }
}
export function clearApiCache() {
  memCache.clear();
  try { Object.keys(localStorage).filter((k) => k.startsWith("c:")).forEach((k) => localStorage.removeItem(k)); } catch { /* تجاهل */ }
}

export async function request(path, { method = "GET", body, isFormData = false, timeout } = {}, attempt = 0) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isFormData) headers["Content-Type"] = "application/json";

  // ما بنعلق للأبد: لو السيرفر ما رد بوقت معقول منطلع رسالة واضحة
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const limit = timeout ?? (isFormData ? 90000 : method === "GET" ? 25000 : 40000);
  const timer = ctrl ? setTimeout(() => ctrl.abort(), limit) : null;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: ctrl?.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // طلبات القراءة بنعيدها مرة وحدة (السيرفر ممكن يكون عم يصحى)
    if (method === "GET" && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1200));
      return request(path, { method, body, isFormData, timeout }, 1);
    }
    // offline = ما وصلنا للسيرفر (أو ما رد) — العملية بتنحفظ على التلفون وبتنبعت بعدين
    const e = new Error(err?.name === "AbortError" ? "السيرفر بطيء هلّأ — جرّب كمان شوي." : "ما في اتصال بالسيرفر — تأكد من الإنترنت وجرّب كمان مرة.");
    e.offline = true;
    throw e;
  }
  clearTimeout(timer);

  let data = null;
  try {
    data = await res.json();
  } catch {
    // بدون جسم استجابة
  }

  if (!res.ok) {
    // الجلسة انتهت أو الحساب انوقف — التطبيق بيرجع لشاشة الدخول
    if (res.status === 401 && !path.startsWith("/auth/login")) {
      window.dispatchEvent(new CustomEvent("auth:expired", { detail: data?.error }));
    }
    // اشتراك المحل خلص أو انوقف — التطبيق بيفتح شاشة التجديد
    if (res.status === 402) {
      window.dispatchEvent(new CustomEvent("shop:locked", { detail: data }));
    }
    const e = new Error(data?.error || (res.status === 404 ? "هالميزة لسا ما وصلت للسيرفر — استنى دقيقتين وجرّب كمان مرة." : `حدث خطأ غير متوقع (${res.status}).`));
    e.status = res.status;
    if ([502, 503, 504].includes(res.status)) e.offline = true; // السيرفر عم يصحى
    e.data = data;
    throw e;
  }
  if (method === "GET") remember(path, data);
  return data;
}

async function downloadFile(path, filename) {
  const token = getToken();
  const res = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("فشل التنزيل.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const api = {
  setupStatus: () => request("/setup/status"),
  createFirstAdmin: (body) => request("/setup/create-first-admin", { method: "POST", body }),
  login: (body) => request("/auth/login", { method: "POST", body }),

  getCustomers: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/customers${qs ? `?${qs}` : ""}`);
  },
  searchCustomers: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/customers/search?${qs}`);
  },
  getCustomer: (id) => request(`/customers/${id}`),
  createCustomer: (body) => request("/customers", { method: "POST", body }),
  updateCustomer: (id, body) => request(`/customers/${id}`, { method: "PUT", body }),
  archiveCustomer: (id) => request(`/customers/${id}`, { method: "DELETE" }),
  getCustomerHistory: (id) => request(`/customers/${id}/history`),
  fixCustomerLocations: () => request("/customers/fix-locations", { method: "POST" }),
  uploadCustomerPhoto: (id, file) => {
    const form = new FormData();
    form.append("photo", file);
    return request(`/customers/${id}/photo`, { method: "POST", body: form, isFormData: true });
  },

  getProducts: (all) => request(`/products${all ? "?all=true" : ""}`),
  createProduct: (body) => request("/products", { method: "POST", body }),
  updateProduct: (id, body) => request(`/products/${id}`, { method: "PUT", body }),
  archiveProduct: (id) => request(`/products/${id}`, { method: "DELETE" }),

  getRegions: () => request("/regions"),
  createRegion: (body) => request("/regions", { method: "POST", body }),
  getAllCustomerLocations: () => request("/customers/all-locations"),
  getMapExtras: () => request("/customers/map-extras"),
  getNextCustomerSeq: () => request("/customers/next-seq"),
  getMessageTemplates: () => request("/settings/messages"),
  saveMessageTemplates: (templates) => request("/settings/messages", { method: "PUT", body: { templates } }),
  getOverdueCustomers: () => request("/customers/overdue"),
  getCustomerPrices: (id) => request(`/customers/${id}/prices`),
  setCustomerPrice: (id, body) => request(`/customers/${id}/prices`, { method: "POST", body }),
  deleteCustomerPrice: (id, productId) => request(`/customers/${id}/prices/${productId}`, { method: "DELETE" }),
  bulkImportCustomers: (rows) => request("/customers/bulk-import", { method: "POST", body: { rows } }),

  getUsers: () => request("/users"),
  createUser: (body) => request("/users", { method: "POST", body }),
  updateUser: (id, body) => request(`/users/${id}`, { method: "PUT", body }),
  viewAsUser: (id) => request(`/users/${id}/view-as`, { method: "POST" }),
  deleteUser: (id) => request(`/users/${id}`, { method: "DELETE" }),

  getOrders: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/orders${qs ? `?${qs}` : ""}`);
  },
  getOrder: (id) => request(`/orders/${id}`),
  createOrder: (body) => request("/orders", { method: "POST", body }),
  getBottles: (inactiveDays) => request(`/bottles${inactiveDays ? `?inactive_days=${inactiveDays}` : ""}`),
  getCustomerBottles: (id) => request(`/bottles/customer/${id}`),
  moveBottles: (id, body) => request(`/bottles/customer/${id}`, { method: "POST", body }),
  setBottleValue: (bottle_value) => request("/bottles/settings", { method: "PUT", body: { bottle_value } }),
  planTrips: (body) => request("/trips/plan", { method: "POST", body }),
  applyTripPlan: (groups) => request("/trips/plan/apply", { method: "POST", body: { groups } }),
  setOrderSchedule: (id, body) => request(`/orders/${id}/schedule`, { method: "PUT", body }),
  updateOrderItems: (id, items) => request(`/orders/${id}/items`, { method: "PUT", body: { items } }),
  setOrderPriority: (id, priority) => request(`/orders/${id}/priority`, { method: "PUT", body: { priority } }),
  applyDiscount: (id, body) => request(`/orders/${id}/discount`, { method: "PUT", body }),
  cancelOrder: (id, reason) => request(`/orders/${id}/cancel`, { method: "POST", body: { reason } }),
  failDelivery: (id, reason) => request(`/orders/${id}/fail`, { method: "POST", body: { reason } }),
  postponeOrder: (id, body) => request(`/orders/${id}/postpone`, { method: "POST", body }),
  reactivateOrder: (id) => request(`/orders/${id}/reactivate`, { method: "POST" }),

  getMyTrip: () => request("/trips/mine"),
  getActiveTripsList: () => request("/trips/active-list"),
  getAvailableDrivers: () => request("/trips/available-drivers"),
  getTripArchive: () => request("/trips/archive"),
  getTripReplay: (id) => request(`/trips/${id}/replay`),
  getSwot: () => request("/swot"),
  saveSwotNotes: (notes) => request("/swot/notes", { method: "PUT", body: notes }),
  getTripDetail: (id) => request(`/trips/${id}`),
  createTrip: (body) => request("/trips", { method: "POST", body }),
  deliverStop: (stopId, itemPayments, extra = {}) => request(`/trips/stops/${stopId}/deliver`, { method: "POST", body: { item_payments: itemPayments, ...extra } }),
  undoDeliver: (stopId) => request(`/trips/stops/${stopId}/undo-deliver`, { method: "POST" }),
  failStop: (stopId, reason) => request(`/trips/stops/${stopId}/fail`, { method: "POST", body: { reason } }),
  completeTrip: (id) => request(`/trips/${id}/complete`, { method: "POST" }),
  updateTripLocation: (id, latitude, longitude) => request(`/trips/${id}/location`, { method: "POST", body: { latitude, longitude } }),
  postponeStop: (stopId, body) => request(`/trips/stops/${stopId}/postpone`, { method: "POST", body }),
  cancelStop: (stopId, reason) => request(`/trips/stops/${stopId}/cancel`, { method: "POST", body: { reason } }),
  updateStopItems: (stopId, items) => request(`/trips/stops/${stopId}/items`, { method: "PUT", body: { items } }),
  sellPackageInTrip: (stopId, body) => request(`/trips/stops/${stopId}/sell-package`, { method: "POST", body }),
  addOrderToTrip: (tripId, orderId) => request(`/trips/${tripId}/add-order`, { method: "POST", body: { order_id: orderId } }),
  reoptimizeTrip: (tripId, style) => request(`/trips/${tripId}/reoptimize`, { method: "POST", body: style ? { style } : {} }),

  getDriverBalances: () => request("/drivers/balances"),
  getDriverPerformance: () => request("/drivers/performance"),
  getDriverBalance: (id) => request(`/drivers/${id}/balance`),
  settleDriver: (id, body) => request(`/drivers/${id}/settle`, { method: "POST", body }),

  getActivityLog: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/activity-log${qs ? `?${qs}` : ""}`);
  },

  getBackupLatest: () => request("/backup/latest"),
  getBackupHistory: () => request("/backup/history"),
  downloadBackup: () => downloadFile("/backup/export", `backup-${new Date().toISOString().slice(0, 10)}.json`),
  downloadBackupSnapshot: (id) => downloadFile(`/backup/${id}/download`, `backup-${id}.json`),

  resolveMapsLink: (url) => request("/geocode/resolve-link", { method: "POST", body: { url } }),
  placeInfo: (body) => request("/geocode/place", { method: "POST", body }),

  getReportsSummary: (period) => request(`/reports/summary?period=${period}`),

  getCashCurrent: () => request("/cash/current"),
  getCashEntry: (date) => request(`/cash/entries/${encodeURIComponent(date)}`),
  saveCashEntry: (body) => request("/cash/entries", { method: "POST", body }),
  resetCashPeriod: () => request("/cash/reset", { method: "POST" }),
  getCashHistory: () => request("/cash/history"),
  getCashHistoryPeriod: (id) => request(`/cash/history/${id}`),
  getCashInsights: () => request("/cash/insights"),
  saveCashSettings: (body) => request("/cash/settings", { method: "PUT", body }),
  getExpenseCategories: () => request("/cash/expense-categories"),
  addExpenseCategory: (body) => request("/cash/expense-categories", { method: "POST", body }),
  deleteExpenseCategory: (id) => request(`/cash/expense-categories/${id}`, { method: "DELETE" }),
  getCashTrend: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/cash/trend${qs ? `?${qs}` : ""}`);
  },

  getCustomerGrowth: (groupBy) => request(`/customers/growth?groupBy=${groupBy}`),

  getNotifications: () => request("/notifications"),
  markNotificationsRead: () => request("/notifications/mark-read", { method: "POST" }),
  getPushPublicKey: () => request("/push/public-key"),
  subscribePush: (subscription) => request("/push/subscribe", { method: "POST", body: { subscription } }),
  unsubscribePush: (endpoint) => request("/push/unsubscribe", { method: "POST", body: { endpoint } }),
  testPush: () => request("/push/test", { method: "POST" }),

  getReminderSchedule: () => request("/reminders/schedule"),
  // ديون العملاء
  getDebts: () => request("/debts"),
  getCustomerDebt: (customerId) => request(`/debts/customer/${customerId}`),
  recordDebtPayment: (customerId, body) => request(`/debts/customer/${customerId}/payment`, { method: "POST", body }),
  // المحطة: السيارات والجولات، المخزون، الكاشير، العهدة
  stVehicles: () => request("/station/vehicles"),
  stVehicle: (id) => request(`/station/vehicles/${id}`),
  stAddVehicle: (body) => request("/station/vehicles", { method: "POST", body }),
  stUpdateVehicle: (id, body) => request(`/station/vehicles/${id}`, { method: "PUT", body }),
  stLoadRound: (vehicleId, body) => request(`/station/vehicles/${vehicleId}/rounds`, { method: "POST", body }),
  stAddToRound: (roundId, body) => request(`/station/rounds/${roundId}/add`, { method: "POST", body }),
  stCloseRound: (roundId, body) => request(`/station/rounds/${roundId}/close`, { method: "POST", body }),
  stStock: () => request("/station/stock"),
  stAddItem: (body) => request("/station/stock/items", { method: "POST", body }),
  stUpdateItem: (id, body) => request(`/station/stock/items/${id}`, { method: "PUT", body }),
  stMove: (id, body) => request(`/station/stock/items/${id}/move`, { method: "POST", body }),
  stItemMoves: (id) => request(`/station/stock/items/${id}/moves`),
  stDecide: (moveId, decision) => request(`/station/stock/moves/${moveId}/${decision}`, { method: "POST" }),
  stSummary: (date) => request(`/station/summary${date ? `?date=${date}` : ""}`),
  stCashier: () => request("/station/cashier"),
  stSell: (body) => request("/station/cashier/sales", { method: "POST", body }),
  stVoidSale: (id) => request(`/station/cashier/sales/${id}/void`, { method: "POST" }),
  stCustody: () => request("/station/custody"),
  stSetCustody: (userId, body) => request(`/station/custody/${userId}`, { method: "PUT", body }),
  getDebtQuickList: () => request("/debts/quick-list"),
  quickPayDebt: (customerId, body) => request(`/debts/customer/${customerId}/quick-pay`, { method: "POST", body }),
  adjustDebt: (customerId, body) => request(`/debts/customer/${customerId}/adjust`, { method: "POST", body }),

  // باقات الكوبونات
  getCouponPackages: (all = false) => request(`/coupons/packages${all ? "?all=true" : ""}`),
  createCouponPackage: (body) => request("/coupons/packages", { method: "POST", body }),
  updateCouponPackage: (id, body) => request(`/coupons/packages/${id}`, { method: "PUT", body }),
  uploadCouponPackageImage: (id, file) => {
    const form = new FormData();
    form.append("photo", file);
    return request(`/coupons/packages/${id}/image`, { method: "POST", body: form, isFormData: true });
  },
  sellCouponPackage: (body) => request("/coupons/sell", { method: "POST", body }),
  getCouponsOverview: () => request("/coupons/overview"),
  getCouponHolders: () => request("/coupons/holders"),

  // حمولة السيارة
  setTripLoad: (tripId, items) => request(`/trips/${tripId}/load`, { method: "POST", body: { items } }),

  // الشات
  // توقعات الطلبات
  getForecast: () => request("/forecast"),
  getCustomerForecast: (id) => request(`/forecast/customer/${id}`),
  snoozeForecast: (id, days = 1) => request(`/forecast/customer/${id}/snooze`, { method: "POST", body: { days } }),
  unsnoozeForecast: (id) => request(`/forecast/customer/${id}/snooze`, { method: "DELETE" }),
  setForecastTracking: (id, disabled) => request(`/forecast/customer/${id}/tracking`, { method: "PUT", body: { disabled } }),
  resetForecast: () => request("/forecast/reset", { method: "POST" }),
  undoForecastReset: () => request("/forecast/reset", { method: "DELETE" }),
  relearnForecast: () => request("/forecast/relearn", { method: "POST" }),
  setForecastSettings: (body) => request("/forecast/settings", { method: "PUT", body }),

  getChatMe: () => request("/chat/me"),
  getChatUnread: () => request("/chat/unread"),
  getChatThreads: () => request("/chat/threads"),
  getChatStaff: () => request("/chat/staff"),
  getChatThread: (userId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/chat/thread/${userId}${qs ? `?${qs}` : ""}`);
  },
  sendChatMessage: (userId, body) => request(`/chat/thread/${userId}`, { method: "POST", body: { body } }),
  sendChatImage: (userId, file, text = "") => {
    const form = new FormData();
    form.append("photo", file);
    if (text) form.append("body", text);
    return request(`/chat/thread/${userId}/image`, { method: "POST", body: form, isFormData: true });
  },
  markChatRead: (userId) => request(`/chat/thread/${userId}/read`, { method: "POST" }),
  deleteChatMessage: (id) => request(`/chat/message/${id}`, { method: "DELETE" }),

  getDashboard: () => request("/dashboard"),
  getMe: () => request("/auth/me"),

  // ---------- موج: الاشتراك والدعم الفني ----------
  getSubscription: () => request("/subscription"),
  sendSubscriptionPayment: ({ file, months, amount, note }) => {
    const form = new FormData();
    form.append("photo", file);
    form.append("months", String(months || 1));
    if (amount) form.append("amount", String(amount));
    if (note) form.append("note", note);
    return request("/subscription/payment", { method: "POST", body: form, isFormData: true });
  },
  getSupportUnread: () => request("/support/unread"),
  getSupportThread: () => request("/support/thread"),
  sendSupportMessage: (body) => request("/support/thread", { method: "POST", body: { body } }),
  sendSupportImage: (file, body = "") => {
    const form = new FormData();
    form.append("photo", file);
    if (body) form.append("body", body);
    return request("/support/thread/image", { method: "POST", body: form, isFormData: true });
  },
  markSupportRead: () => request("/support/read", { method: "POST" }),

  // ---------- لوحة إدارة موج ----------
  platformOverview: () => request("/platform/overview"),
  platformTenants: () => request("/platform/tenants"),
  platformTenant: (id) => request(`/platform/tenants/${id}`),
  platformCreateTenant: (body) => request("/platform/tenants", { method: "POST", body }),
  platformUpdateTenant: (id, body) => request(`/platform/tenants/${id}`, { method: "PUT", body }),
  platformFeatures: () => request("/platform/features"),
  platformSetFeatures: (id, features) => request(`/platform/tenants/${id}/features`, { method: "PUT", body: { features } }),
  platformExtendTenant: (id, body) => request(`/platform/tenants/${id}/extend`, { method: "POST", body }),
  platformDeleteTenant: (id) => request(`/platform/tenants/${id}`, { method: "DELETE", body: { confirm: "احذف" } }),
  platformInspectTenant: (id) => request(`/platform/tenants/${id}/inspect`, { method: "POST" }),
  platformResetTenant: (id, sample) => request(`/platform/tenants/${id}/reset`, { method: "POST", body: { sample } }),
  clearSampleData: () => request("/subscription/clear-sample", { method: "POST", body: { confirm: "امسح" } }),
  getSampleCount: () => request("/subscription/sample"),
  platformSampleCount: (id) => request(`/platform/tenants/${id}/sample`),
  platformClearSample: (id) => request(`/platform/tenants/${id}/clear-sample`, { method: "POST" }),
  platformResetPassword: (id, body) => request(`/platform/tenants/${id}/reset-password`, { method: "POST", body }),
  platformPayments: (status) => request(`/platform/payments${status ? `?status=${status}` : ""}`),
  platformApprovePayment: (id, body = {}) => request(`/platform/payments/${id}/approve`, { method: "POST", body }),
  platformRejectPayment: (id, note) => request(`/platform/payments/${id}/reject`, { method: "POST", body: { note } }),
  platformSupportThreads: () => request("/platform/support/threads"),
  platformSupportThread: (tenantId) => request(`/platform/support/thread/${tenantId}`),
  platformSupportSend: (tenantId, body) => request(`/platform/support/thread/${tenantId}`, { method: "POST", body: { body } }),
  platformSupportImage: (tenantId, file, body = "") => {
    const form = new FormData();
    form.append("photo", file);
    if (body) form.append("body", body);
    return request(`/platform/support/thread/${tenantId}/image`, { method: "POST", body: form, isFormData: true });
  },
  platformSupportRead: (tenantId) => request(`/platform/support/thread/${tenantId}/read`, { method: "POST" }),
  platformSettings: () => request("/platform/settings"),
  platformSaveSettings: (body) => request("/platform/settings", { method: "PUT", body }),
  platformSupportPhoto: (file) => {
    const form = new FormData();
    form.append("photo", file);
    return request("/platform/settings/support-photo", { method: "POST", body: form, isFormData: true });
  },
  platformUsernameAvailable: (u) => request(`/platform/username-available?u=${encodeURIComponent(u)}`),

  // ---------- الموظفين والرواتب ----------
  payrollSummary: (date) => request(`/payroll/summary${date ? `?date=${date}` : ""}`),
  payrollEmployee: (id, month) => request(`/payroll/employees/${id}${month ? `?month=${month}` : ""}`),
  payrollCreateEmployee: (body) => request("/payroll/employees", { method: "POST", body }),
  payrollUpdateEmployee: (id, body) => request(`/payroll/employees/${id}`, { method: "PUT", body }),
  payrollAttendance: (body) => request("/payroll/attendance", { method: "POST", body }),
  payrollAddTransaction: (id, body) => request(`/payroll/employees/${id}/transactions`, { method: "POST", body }),
  payrollDeleteTransaction: (txId) => request(`/payroll/transactions/${txId}`, { method: "DELETE" }),
  payrollUsers: () => request("/payroll/users"),
  payrollMe: () => request("/payroll/me"),
  payrollCheckIn: () => request("/payroll/me/check-in", { method: "POST" }),

  // ---------- الجرد والفواتير ----------
  getJard: (date) => request(`/jard${date ? `?date=${date}` : ""}`),
  getInvoiceLink: (orderId) => request(`/invoices/order/${orderId}`, { method: "POST" }),
  getPublicInvoice: (token) => request(`/public/invoice/${encodeURIComponent(token)}`),
  getWalletLink: (customerId) => request(`/invoices/wallet/${customerId}`, { method: "POST" }),
  getPublicWallet: (token) => request(`/public/wallet/${encodeURIComponent(token)}`),
  getPermissionsMeta: () => request("/auth/permissions-meta"),
  getShopLocation: () => request("/settings/shop-location"),
  setShopLocation: (body) => request("/settings/shop-location", { method: "PUT", body }),
  getCustomerReminder: (customerId) => request(`/reminders/${customerId}`),
  setCustomerReminder: (customerId, body) => request(`/reminders/${customerId}`, { method: "POST", body }),
  deleteCustomerReminder: (customerId) => request(`/reminders/${customerId}`, { method: "DELETE" }),

  getCustomerCount: () => request("/customers/count"),
  renumberCustomers: () => request("/customers/renumber", { method: "POST" }),
  getCouponHistory: (customerId) => request(`/customers/${customerId}/coupon-history`),
  adjustCouponBalance: (customerId, body) => request(`/customers/${customerId}/coupons/adjust`, { method: "POST", body }),

  getMyNotes: () => request("/notes"),
  addMyNote: (content) => request("/notes", { method: "POST", body: { content } }),
  deleteMyNote: (id) => request(`/notes/${id}`, { method: "DELETE" }),
};
