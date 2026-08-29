import React, { useEffect, useState } from 'react';
import API from '../api';

const EMPTY_FORM = {
  plateNumber: '',
  make: '',
  model: '',
  year: '',
  color: '',
  type: 'sedan',
  fuelType: 'petrol'
};

function StatusBadge({ status }) {
  const map = { active: 'badge-green', maintenance: 'badge-orange', inactive: 'badge-gray' };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}

function normalizeList(data) {
  if (Array.isArray(data)) return { items: data, nextCursor: null, hasMore: false };
  return {
    items: data?.items || [],
    nextCursor: data?.nextCursor || null,
    hasMore: !!data?.hasMore
  };
}

export default function Vehicles() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = (cursor = null, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    API.get('/admin/vehicles', { params: { limit: 50, ...(cursor ? { cursor } : {}) } })
      .then((res) => {
        const page = normalizeList(res.data);
        setVehicles((prev) => (append ? [...prev, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  };

  useEffect(() => load(), []);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await API.post('/admin/vehicles', {
        ...form,
        year: form.year ? Number(form.year) : undefined
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create vehicle');
    } finally {
      setSaving(false);
    }
  };

  const cycleStatus = async (vehicle) => {
    const order = ['active', 'maintenance', 'inactive'];
    const next = order[(order.indexOf(vehicle.status) + 1) % order.length];
    try {
      await API.put(`/admin/vehicles/${vehicle._id}`, { status: next });
      setVehicles((prev) => prev.map((v) => (v._id === vehicle._id ? { ...v, status: next } : v)));
    } catch {
      alert('Could not update vehicle status');
    }
  };

  return (
    <div>
      <h1>Vehicles</h1>
      <div className="toolbar">
        <button className="btn btn-primary" style={{ width: 'auto' }} onClick={() => setShowForm(true)}>
          + Add vehicle
        </button>
      </div>

      <div className="table-card">
        {loading ? (
          <div className="loading">Loading…</div>
        ) : vehicles.length === 0 ? (
          <div className="empty">No vehicles registered yet</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Vehicle</th>
                  <th>Type</th>
                  <th>Fuel</th>
                  <th>Assigned driver</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v._id}>
                    <td>{v.plateNumber}</td>
                    <td>{v.make} {v.model} {v.year ? `(${v.year})` : ''}</td>
                    <td style={{ textTransform: 'capitalize' }}>{v.type}</td>
                    <td style={{ textTransform: 'capitalize' }}>{v.fuelType}</td>
                    <td>{v.assignedTo?.fullName || '—'}</td>
                    <td><StatusBadge status={v.status} /></td>
                    <td>
                      <button className="action-link" onClick={() => cycleStatus(v)}>
                        Change status
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

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Add vehicle</h2>
            {error && <div className="error-text">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Plate number</label>
                <input value={form.plateNumber} onChange={handleChange('plateNumber')} required />
              </div>
              <div className="field">
                <label>Make</label>
                <input value={form.make} onChange={handleChange('make')} required />
              </div>
              <div className="field">
                <label>Model</label>
                <input value={form.model} onChange={handleChange('model')} required />
              </div>
              <div className="field">
                <label>Year</label>
                <input type="number" value={form.year} onChange={handleChange('year')} />
              </div>
              <div className="field">
                <label>Color</label>
                <input value={form.color} onChange={handleChange('color')} />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={form.type} onChange={handleChange('type')}>
                  <option value="sedan">Sedan</option>
                  <option value="suv">SUV</option>
                  <option value="minibus">Minibus</option>
                  <option value="hatchback">Hatchback</option>
                </select>
              </div>
              <div className="field">
                <label>Fuel type</label>
                <select value={form.fuelType} onChange={handleChange('fuelType')}>
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                  <option value="electric">Electric</option>
                </select>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
                  {saving ? 'Saving…' : 'Save vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
