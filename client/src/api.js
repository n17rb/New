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

export const api = {
  setupStatus: () => request("/setup/status"),
  createFirstAdmin: (body) => request("/setup/create-first-admin", { method: "POST", body }),
  login: (body) => request("/auth/login", { method: "POST", body }),

  getCustomers: (q) => request(`/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getCustomer: (id) => request(`/customers/${id}`),
  createCustomer: (body) => request("/customers", { method: "POST", body }),
  updateCustomer: (id, body) => request(`/customers/${id}`, { method: "PUT", body }),
  archiveCustomer: (id) => request(`/customers/${id}`, { method: "DELETE" }),
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

  getUsers: () => request("/users"),
  createUser: (body) => request("/users", { method: "POST", body }),
  updateUser: (id, body) => request(`/users/${id}`, { method: "PUT", body }),

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
  postponeOrder: (id, postponed_to) => request(`/orders/${id}/postpone`, { method: "POST", body: { postponed_to } }),
  reactivateOrder: (id) => request(`/orders/${id}/reactivate`, { method: "POST" }),

  getActiveTrip: () => request("/trips/active"),
  createTrip: (body) => request("/trips", { method: "POST", body }),
  startTrip: (id) => request(`/trips/${id}/start`, { method: "POST" }),
  deliverStop: (stopId) => request(`/trips/stops/${stopId}/deliver`, { method: "POST" }),
  failStop: (stopId, reason) => request(`/trips/stops/${stopId}/fail`, { method: "POST", body: { reason } }),
  completeTrip: (id) => request(`/trips/${id}/complete`, { method: "POST" }),
  updateTripLocation: (id, latitude, longitude) => request(`/trips/${id}/location`, { method: "POST", body: { latitude, longitude } }),
  postponeStop: (stopId, body) => request(`/trips/stops/${stopId}/postpone`, { method: "POST", body }),
  cancelStop: (stopId, reason) => request(`/trips/stops/${stopId}/cancel`, { method: "POST", body: { reason } }),

  getDriversList: () => request("/drivers/list"),
  getDriverBalances: () => request("/drivers/balances"),
  getDriverBalance: (id) => request(`/drivers/${id}/balance`),
  settleDriver: (id, body) => request(`/drivers/${id}/settle`, { method: "POST", body }),

  resolveMapsLink: (url) => request("/geocode/resolve-link", { method: "POST", body: { url } }),
};
