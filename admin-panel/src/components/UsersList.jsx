import React, { useEffect, useState } from 'react';
import API from '../api';

function StatusBadge({ status }) {
  return (
    <span className={`badge ${status === 'suspended' ? 'badge-red' : 'badge-green'}`}>
      {status || 'active'}
    </span>
  );
}

function normalizeList(data) {
  if (Array.isArray(data)) return { items: data, nextCursor: null, hasMore: false };
  return {
    items: data?.items || [],
    nextCursor: data?.nextCursor || null,
    hasMore: !!data?.hasMore
  };
}

export default function UsersList({ role, title }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = (cursor = null, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    API.get('/admin/users', { params: { role, limit: 50, ...(cursor ? { cursor } : {}) } })
      .then((res) => {
        const page = normalizeList(res.data);
        setUsers((prev) => (append ? [...prev, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  };

  useEffect(() => {
    setUsers([]);
    setNextCursor(null);
    setHasMore(false);
    load();
  }, [role]);

  const toggleStatus = async (user) => {
    const nextStatus = user.status === 'suspended' ? 'active' : 'suspended';
    setBusyId(user._id);
    try {
      await API.put(`/admin/users/${user._id}/status`, { status: nextStatus });
      setUsers((prev) => prev.map((u) => (u._id === user._id ? { ...u, status: nextStatus } : u)));
    } catch {
      alert('Could not update user status');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h1>{title}</h1>
      <div className="table-card">
        {loading ? (
          <div className="loading">Loading…</div>
        ) : users.length === 0 ? (
          <div className="empty">No {role}s yet</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  {role === 'driver' && <th>Vehicle</th>}
                  {role === 'driver' && <th>Online</th>}
                  <th>Joined</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id}>
                    <td>{u.fullName}</td>
                    <td>{u.phone}</td>
                    {role === 'driver' && (
                      <td>
                        {u.driverDetails?.vehicleId
                          ? `${u.driverDetails.vehicleId.make || ''} ${u.driverDetails.vehicleId.model || ''} (${u.driverDetails.vehicleId.plateNumber || 'n/a'})`
                          : '—'}
                      </td>
                    )}
                    {role === 'driver' && (
                      <td>
                        <span className={`badge ${u.driverDetails?.isOnline ? 'badge-green' : 'badge-gray'}`}>
                          {u.driverDetails?.isOnline ? 'Online' : 'Offline'}
                        </span>
                      </td>
                    )}
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td><StatusBadge status={u.status} /></td>
                    <td>
                      <button
                        className="action-link"
                        disabled={busyId === u._id}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  className="action-link"
                  disabled={loadingMore}
                  onClick={() => load(nextCursor, true)}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
