import React, { createContext, useContext, useState } from 'react';
import API, { clearAdminSession } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('adminUser');
    return raw ? JSON.parse(raw) : null;
  });

  const login = async (phone, password) => {
    const res = await API.post('/auth/login', { phone, password });
    if (res.data.role !== 'admin') {
      throw new Error('This account does not have admin access');
    }
    const access = res.data.accessToken || res.data.token;
    localStorage.setItem('adminToken', access);
    if (res.data.refreshToken) {
      localStorage.setItem('adminRefreshToken', res.data.refreshToken);
    }
    localStorage.setItem('adminUser', JSON.stringify(res.data));
    setUser(res.data);
    return res.data;
  };

  const logout = async () => {
    try {
      const refreshToken = localStorage.getItem('adminRefreshToken');
      const access = localStorage.getItem('adminToken');
      if (refreshToken || access) {
        await API.post(
          '/auth/logout',
          refreshToken ? { refreshToken, all: true } : { all: true },
          access ? { headers: { Authorization: `Bearer ${access}` } } : undefined
        ).catch(() => {});
      }
    } finally {
      clearAdminSession();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
