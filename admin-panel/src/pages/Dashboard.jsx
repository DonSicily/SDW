import React, { useEffect, useState } from 'react';
import API from '../api';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    API.get('/admin/stats')
      .then((res) => setStats(res.data))
      .catch(() => setError('Could not load dashboard stats'));
  }, []);

  if (error) return <div className="empty">{error}</div>;
  if (!stats) return <div className="loading">Loading…</div>;

  const cards = [
    { label: 'Total riders', value: stats.totalRiders },
    { label: 'Total drivers', value: stats.totalDrivers },
    { label: 'Drivers online now', value: stats.onlineDrivers },
    { label: 'Registered vehicles', value: stats.totalVehicles },
    { label: 'Total rides', value: stats.totalRides },
    { label: 'Revenue collected', value: `₦${stats.totalRevenue.toLocaleString()}` }
  ];

  return (
    <div>
      <h1>Dashboard</h1>
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="label">{c.label}</div>
            <div className="value">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="table-card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Rides by status</h3>
        {Object.keys(stats.ridesByStatus).length === 0 ? (
          <div className="empty">No rides yet</div>
        ) : (
          <table>
            <thead>
              <tr><th>Status</th><th>Count</th></tr>
            </thead>
            <tbody>
              {Object.entries(stats.ridesByStatus).map(([status, count]) => (
                <tr key={status}>
                  <td style={{ textTransform: 'capitalize' }}>{status}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
