import { NavLink, Outlet, Route, Routes } from "react-router-dom";
import { ConnectButton, NetworkBanner } from "./components/Wallet";
import { chain, ROUTER_ADDRESS } from "./lib/config";
import { Dashboard } from "./pages/Dashboard";
import { History } from "./pages/History";
import { Pay } from "./pages/Pay";
import { Receive } from "./pages/Receive";
import { Send } from "./pages/Send";

const NAV = [
  ["/", "Home"],
  ["/send", "Send"],
  ["/receive", "Receive"],
  ["/history", "History"],
] as const;

function Layout() {
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="logo" />
          BasePay
        </NavLink>
        <nav className="nav">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              {label}
            </NavLink>
          ))}
        </nav>
        <ConnectButton />
      </header>
      <NetworkBanner />
      <main className="container">
        <Outlet />
      </main>
      <footer className="footer muted small">
        USDC on {chain.name}
        {ROUTER_ADDRESS ? " · BasePay router enabled" : " · direct transfers"}
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="send" element={<Send />} />
        <Route path="receive" element={<Receive />} />
        <Route path="history" element={<History />} />
        <Route path="pay" element={<Pay />} />
        <Route path="*" element={<p className="empty">Page not found.</p>} />
      </Route>
    </Routes>
  );
}
