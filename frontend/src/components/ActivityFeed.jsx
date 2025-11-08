import React from 'react';

const containerStyle = {
  background: '#ffffff',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  minHeight: '220px',
};

const listStyle = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const badgeStyles = {
  info: {
    background: 'rgba(37, 99, 235, 0.12)',
    color: '#1d4ed8',
  },
  success: {
    background: 'rgba(34, 197, 94, 0.14)',
    color: '#047857',
  },
  warning: {
    background: 'rgba(234, 179, 8, 0.16)',
    color: '#b45309',
  },
  error: {
    background: 'rgba(220, 38, 38, 0.14)',
    color: '#b91c1c',
  },
};

const itemStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  paddingBottom: '12px',
  borderBottom: '1px solid #e2e8f0',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '8px',
};

const badgeBaseStyle = {
  fontSize: '12px',
  fontWeight: 600,
  borderRadius: '999px',
  padding: '4px 10px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
};

const timestampStyle = {
  color: '#94a3b8',
  fontSize: '12px',
};

const emptyStyle = {
  color: '#94a3b8',
  textAlign: 'center',
  padding: '24px 0',
};

const ActivityFeed = ({ entries = [] }) => (
  <div style={containerStyle}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <h2 style={{ margin: 0 }}>Trade Activity</h2>
      <span style={{ fontSize: '13px', color: '#64748b' }}>Last {entries.length} entries</span>
    </div>
    {entries.length === 0 ? (
      <div style={emptyStyle}>No trade activity yet. Submit or cancel an order to see updates here.</div>
    ) : (
      <ul style={listStyle}>
        {entries.map((entry) => {
          const badgeStyle = {
            ...badgeBaseStyle,
            ...(badgeStyles[entry.variant] || badgeStyles.info),
          };
          return (
            <li key={entry.id} style={itemStyle}>
              <div style={headerStyle}>
                <span style={badgeStyle}>{entry.title}</span>
                <span style={timestampStyle}>{entry.timestamp}</span>
              </div>
              <div style={{ color: '#1e293b', fontSize: '14px', lineHeight: 1.6 }}>{entry.message}</div>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

export default ActivityFeed;
