// While developing, the API is a separate server (localhost:4000, or whatever
// VITE_API_URL says). A production build is served BY the API server, so an
// empty base ("same origin") is the right default there.
const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include", // send/receive the httpOnly session cookie
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export const register = (name, email, password) =>
  request("/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) });

export const login = (email, password) =>
  request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

export const logout = () => request("/api/auth/logout", { method: "POST" });

export const getMe = () => request("/api/auth/me");

export const createRoom = (name) =>
  request("/api/rooms", { method: "POST", body: JSON.stringify({ name }) });

export const joinRoom = (joinCode) =>
  request("/api/rooms/join", { method: "POST", body: JSON.stringify({ joinCode }) });

export const getMyRooms = () => request("/api/rooms/mine");

export const getRoom = (roomId) => request(`/api/rooms/${roomId}`);

export const listPins = (roomId) => request(`/api/rooms/${roomId}/pins`);

export const createPin = (roomId, pin) =>
  request(`/api/rooms/${roomId}/pins`, { method: "POST", body: JSON.stringify(pin) });

export const toggleVote = (roomId, pinId) =>
  request(`/api/rooms/${roomId}/pins/${pinId}/vote`, { method: "POST" });

export const getMessages = (roomId) => request(`/api/rooms/${roomId}/messages`);

export const getItinerary = (roomId) => request(`/api/rooms/${roomId}/itinerary`);

export const placeStop = (roomId, pinId, dayNumber, beforePinId = null) =>
  request(`/api/rooms/${roomId}/itinerary/stops/${pinId}`, {
    method: "PUT",
    body: JSON.stringify({ dayNumber, beforePinId }),
  });

export const removeStop = (roomId, pinId) =>
  request(`/api/rooms/${roomId}/itinerary/stops/${pinId}`, { method: "DELETE" });

export const optimizeDay = (roomId, dayNumber) =>
  request(`/api/rooms/${roomId}/itinerary/days/${dayNumber}/optimize`, { method: "POST" });
