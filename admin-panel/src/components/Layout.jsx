import React from 'react';
import { NavLink, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../AuthContext';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/users', label: 'Riders' },
  { to: '/drivers', label: 'Drivers' },
  { to: '/rides', label: 'Rides' },
  { to: '/vehicles', label: 'Vehicles' }
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/logo.png" alt="SDW" className="sidebar-logo" />
          <h2>SDW Admin</h2>
        </div>
        <nav>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="logout" onClick={handleLogout}>
          Sign out {user?.fullName ? `(${user.fullName})` : ''}
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
