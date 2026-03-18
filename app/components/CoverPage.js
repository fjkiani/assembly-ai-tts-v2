/**
 * CoverPage — Panic Button Cover (BS3)
 * 
 * Triggered by ESC. Renders a fake localhost developer environment
 * that looks like Swagger API docs or a JSON response page.
 * If accidentally broadcast during screen share, it looks like
 * you have documentation or an API test page open.
 * 
 * No props. Completely self-contained.
 */
import styles from './CoverPage.module.css';

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/v2/users', status: '200', desc: 'List all users' },
  { method: 'POST', path: '/api/v2/users', status: '201', desc: 'Create a new user' },
  { method: 'GET', path: '/api/v2/users/{id}', status: '200', desc: 'Get user by ID' },
  { method: 'PUT', path: '/api/v2/users/{id}', status: '200', desc: 'Update user' },
  { method: 'DELETE', path: '/api/v2/users/{id}', status: '204', desc: 'Delete user' },
  { method: 'GET', path: '/api/v2/health', status: '200', desc: 'Health check' },
  { method: 'GET', path: '/api/v2/sessions', status: '200', desc: 'List active sessions' },
  { method: 'POST', path: '/api/v2/auth/token', status: '200', desc: 'Generate auth token' },
];

const SAMPLE_RESPONSE = `{
  "status": "ok",
  "version": "2.4.1",
  "uptime": "14d 7h 23m",
  "services": {
    "database": "connected",
    "cache": "connected",
    "queue": "healthy"
  },
  "metrics": {
    "requests_per_minute": 847,
    "avg_response_ms": 42,
    "error_rate": "0.02%"
  }
}`;

const METHOD_COLORS = {
  GET: '#61affe',
  POST: '#49cc90',
  PUT: '#fca130',
  DELETE: '#f93e3e',
};

export default function CoverPage() {
  return (
    <div className={styles.root}>
      {/* Browser-like top bar */}
      <div className={styles.urlBar}>
        <div className={styles.urlDots}>
          <span className={styles.dot} style={{ background: '#ff5f57' }} />
          <span className={styles.dot} style={{ background: '#febc2e' }} />
          <span className={styles.dot} style={{ background: '#28c840' }} />
        </div>
        <div className={styles.urlInput}>
          <span className={styles.urlLock}>🔒</span>
          localhost:3000/api-docs
        </div>
      </div>

      {/* Swagger-like header */}
      <div className={styles.header}>
        <h1 className={styles.title}>User Service API</h1>
        <span className={styles.version}>v2.4.1</span>
        <p className={styles.subtitle}>Internal microservice — user management &amp; authentication</p>
        <div className={styles.baseUrl}>
          Base URL: <code>http://localhost:3000/api/v2</code>
        </div>
      </div>

      {/* Endpoints list */}
      <div className={styles.endpoints}>
        {API_ENDPOINTS.map((ep, i) => (
          <div key={i} className={styles.endpoint}>
            <span
              className={styles.method}
              style={{ background: METHOD_COLORS[ep.method] || '#888' }}
            >
              {ep.method}
            </span>
            <span className={styles.path}>{ep.path}</span>
            <span className={styles.desc}>{ep.desc}</span>
            <span className={styles.status}>{ep.status}</span>
          </div>
        ))}
      </div>

      {/* Sample response */}
      <div className={styles.responseSection}>
        <div className={styles.responseHeader}>
          <span className={styles.responseTitle}>GET /api/v2/health</span>
          <span className={styles.responseStatus}>200 OK</span>
        </div>
        <pre className={styles.responseBody}>{SAMPLE_RESPONSE}</pre>
      </div>

      <div className={styles.footer}>
        <span className={styles.hint}>Press ESC to return</span>
      </div>
    </div>
  );
}
