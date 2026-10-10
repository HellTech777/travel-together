import { io } from "socket.io-client";

// Same default as api.js: localhost:4000 while developing, the page's own
// origin in a production build (where the API server also serves the app).
const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

// A single shared connection for the whole app. withCredentials sends the
// httpOnly session cookie along with the WebSocket handshake, which is what
// the server's Socket.io auth middleware reads to identify the member.
// socket.io-client wants `undefined` (not "") to mean "this page's origin".
export const socket = io(API_URL || undefined, {
  withCredentials: true,
  autoConnect: true,
});
