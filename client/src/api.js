const BASE = "https://new-mha6.onrender.com/api";
export const API_ORIGIN = BASE.replace(/\/api$/, "");

function getToken() {
  return localStorage.getItem("token");
}

async function request(path, { method = "GET", body, isFormData = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isFormData) headers["Content-Type"] = "application/json";

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // بدون جسم استجابة
  }

  if (!res.ok) {
    throw new Error(data?.error || "حدث خطأ غير متوقع.");
  }
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
  getOverdueCustomers: () => request("/customers/overdue"),
  getCustomerPrices: (id) => request(`/customers/${id}/prices`),
  setCustomerPrice: (id, body) => request(`/customers/${id}/prices`, { method: "POST", body }),
  deleteCustomerPrice: (id, productId) => request(`/customers/${id}/prices/${productId}`, { method: "DELETE" }),
  bulkImportCustomers: (rows) => request("/customers/bulk-import", { method: "POST", body: { rows } }),

  getUsers: () => request("/users"),
  createUser: (body) => request("/users", { method: "POST", body }),
  updateUser: (id, body) => request(`/users/${id}`, { method: "PUT", body }),
  deleteUser: (id) => request(`/users/${id}`, { method: "DELETE" }),

  getOrders: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/orders${qs ? `?${qs}` : ""}`);
  },
  getOrder: (id) => request(`/orders/${id}`),
  createOrder: (body) => request("/orders", { method: "POST", body }),
  updateOrderItems: (id, items) => request(`/orders/${id}/items`, { method: "PUT", body: { items } }),
  setOrderPriority: (id, priority) => request(`/orders/${id}/priority`, { method: "PUT", body: { priority } }),
  applyDiscount: (id, body) => request(`/orders/${id}/discount`, { method: "PUT", body }),
  cancelOrder: (id, reason) => request(`/orders/${id}/cancel`, { method: "POST", body: { reason } }),
  failDelivery: (id, reason) => request(`/orders/${id}/fail`, { method: "POST", body: { reason } }),
  postponeOrder: (id, postponed_to, reason) => request(`/orders/${id}/postpone`, { method: "POST", body: { postponed_to, reason } }),
  reactivateOrder: (id) => request(`/orders/${id}/reactivate`, { method: "POST" }),

  getMyTrip: () => request("/trips/mine"),
  getActiveTripsList: () => request("/trips/active-list"),
  getAvailableDrivers: () => request("/trips/available-drivers"),
  getTripArchive: () => request("/trips/archive"),
  getTripDetail: (id) => request(`/trips/${id}`),
  createTrip: (body) => request("/trips", { method: "POST", body }),
  deliverStop: (stopId) => request(`/trips/stops/${stopId}/deliver`, { method: "POST" }),
  undoDeliver: (stopId) => request(`/trips/stops/${stopId}/undo-deliver`, { method: "POST" }),
  failStop: (stopId, reason) => request(`/trips/stops/${stopId}/fail`, { method: "POST", body: { reason } }),
  completeTrip: (id) => request(`/trips/${id}/complete`, { method: "POST" }),
  updateTripLocation: (id, latitude, longitude) => request(`/trips/${id}/location`, { method: "POST", body: { latitude, longitude } }),
  postponeStop: (stopId, body) => request(`/trips/stops/${stopId}/postpone`, { method: "POST", body }),
  cancelStop: (stopId, reason) => request(`/trips/stops/${stopId}/cancel`, { method: "POST", body: { reason } }),
  addOrderToTrip: (tripId, orderId) => request(`/trips/${tripId}/add-order`, { method: "POST", body: { order_id: orderId } }),

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

  getReportsSummary: (period) => request(`/reports/summary?period=${period}`),

  getCashCurrent: () => request("/cash/current"),
  saveCashEntry: (body) => request("/cash/entries", { method: "POST", body }),
  resetCashPeriod: () => request("/cash/reset", { method: "POST" }),
  getCashHistory: () => request("/cash/history"),
  getCashTrend: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/cash/trend${qs ? `?${qs}` : ""}`);
  },

  getCustomerGrowth: (groupBy) => request(`/customers/growth?groupBy=${groupBy}`),

  getNotifications: () => request("/notifications"),
  markNotificationsRead: () => request("/notifications/mark-read", { method: "POST" }),

  getCustomerReminder: (customerId) => request(`/reminders/${customerId}`),
  setCustomerReminder: (customerId, body) => request(`/reminders/${customerId}`, { method: "POST", body }),
  deleteCustomerReminder: (customerId) => request(`/reminders/${customerId}`, { method: "DELETE" }),
};
