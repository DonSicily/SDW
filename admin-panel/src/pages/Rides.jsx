import React, { useEffect, useState } from 'react';
import API from '../api';

const STATUS_FILTERS = ['all', 'pending', 'accepted', 'arrived', 'started', 'completed', 'cancelled'];

function PaymentBadge({ status }) {
  const map = {
    paid: 'badge-green',
    pending: 'badge-orange',
    failed: 'badge-red',
    unpaid: 'badge-gray'
  };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status || 'unpaid'}</span>;
}

function normalizeList(data) {
  if (Array.isArray(data)) return { items: data, nextCursor: null, hasMore: false };
  return {
    items: data?.items || [],
    nextCursor: data?.nextCursor || null,
    hasMore: !!data?.hasMore
  };
}

export default function Rides() {
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = (status, cursor = null, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    const params = { limit: 50, ...(cursor ? { cursor } : {}) };
    if (status !== 'all') params.status = status;
    API.get('/admin/rides', { params })
      .then((res) => {
        const page = normalizeList(res.data);
        setRides((prev) => (append ? [...prev, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  };

  useEffect(() => {
    setRides([]);
    setNextCursor(null);
    setHasMore(false);
    load(filter);
  }, [filter]);

  return (
    <div>
      <h1>Rides</h1>
      <div className="filters">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={filter === s ? 'active' : ''}
            onClick={() => setFilter(s)}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>
      <div className="table-card">
        {loading ? (
          <div className="loading">Loading…</div>
        ) : rides.length === 0 ? (
          <div className="empty">No rides found</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Rider</th>
                  <th>Driver</th>
                  <th>Route</th>
                  <th>Fare</th>
                  <th>Status</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {rides.map((r) => (
                  <tr key={r._id}>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td>{r.riderId?.fullName || '—'}</td>
                    <td>{r.driverId?.fullName || '—'}</td>
                    <td>
                      {(r.pickup?.address || '?').slice(0, 24)} → {(r.dropoff?.address || '?').slice(0, 24)}
                    </td>
                    <td>₦{r.finalFare || r.fare?.standard || 0}</td>
                    <td style={{ textTransform: 'capitalize' }}>{r.status.replace('_', ' ')}</td>
                    <td><PaymentBadge status={r.paymentStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  className="action-link"
                  disabled={loadingMore}
                  onClick={() => load(filter, nextCursor, true)}
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
