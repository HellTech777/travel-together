require("dotenv").config();

const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const roomRoutes = require("./routes/rooms");
const pinRoutes = require("./routes/pins");
const messageRoutes = require("./routes/messages");
const itineraryRoutes = require("./routes/itinerary");
const registerChatSocket = require("./sockets/chat");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const app = express();

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true, // required so the browser sends/receives the session cookie
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/rooms/:roomId/pins", pinRoutes);
app.use("/api/rooms/:roomId/messages", messageRoutes);
app.use("/api/rooms/:roomId/itinerary", itineraryRoutes);

// In production this same server also serves the built React app (client/dist),
// so the browser sees ONE origin: the session cookie is first-party (cross-site
// cookies get blocked by Safari/Firefox) and there's no CORS to configure.
// While developing, the client runs on its own Vite dev server and client/dist
// doesn't exist, so this whole block is skipped.
const clientDist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(path.join(clientDist, "index.html"))) {
  // Built filenames contain a content hash, so they can be cached for a long time.
  app.use("/assets", express.static(path.join(clientDist, "assets"), { maxAge: "1y", immutable: true }));
  app.use(express.static(clientDist));

  // React Router owns page URLs like /rooms/5. A refresh (or a shared link) on
  // one of them has to get the app, so any other page request falls back to
  // index.html. API calls, socket traffic and missing files (*.js, *.png ...)
  // are left alone so they still get a real 404 instead of an HTML page.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/socket.io/") || path.extname(req.path)) {
      return next();
    }
    return res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Socket.io needs the raw HTTP server (not just the Express app) so it can
// perform the WebSocket upgrade on the same port as the REST API.
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_URL, credentials: true },
});
registerChatSocket(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Travel Together API running on http://localhost:${PORT}`);
});
