import { Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect, createContext, useContext } from "react";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import RoomChooser from "./pages/RoomChooser.jsx";
import RoomBoard from "./pages/RoomBoard.jsx";
import { getMe, logout as apiLogout } from "./api.js";

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await apiLogout().catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, logout }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/rooms" replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/rooms" replace /> : <Register />} />

        {/* After login: choose to create a new trip or join one with a code */}
        <Route
          path="/rooms"
          element={
            <RequireAuth>
              <RoomChooser />
            </RequireAuth>
          }
        />

        {/* Inside a specific trip — this is where the map/chat/itinerary land next */}
        <Route
          path="/rooms/:roomId"
          element={
            <RequireAuth>
              <RoomBoard />
            </RequireAuth>
          }
        />

        <Route path="*" element={loading ? null : <Navigate to={user ? "/rooms" : "/login"} replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
