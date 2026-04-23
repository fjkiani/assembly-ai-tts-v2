# SECURITY PATCHES REQUIRED

## ⚠️ CRITICAL: Leaked API Keys — Immediate Action Required

Both keys below are already exposed in the public repository and **must be rotated immediately** at their respective provider dashboards before any further commits or deployments.

---

## Patch 1: `app/api/token/route.js` — Hardcoded AssemblyAI API Key

**Problem:** The file contains a hardcoded AssemblyAI API key used as a fallback when the environment variable is not set. This key is now publicly exposed.

**Required change:**

Remove the hardcoded key fallback. Replace any pattern like:

```javascript
const apiKey = process.env.ASSEMBLYAI_API_KEY || 'YOUR_HARDCODED_KEY_HERE';
```

With:

```javascript
const apiKey = process.env.ASSEMBLYAI_API_KEY;
if (!apiKey) {
  throw new Error('ASSEMBLYAI_API_KEY environment variable is required');
}
```

**Action items:**
1. Go to https://www.assemblyai.com/dashboard and revoke/rotate the exposed key immediately.
2. Set the new key as `ASSEMBLYAI_API_KEY` in your `.env.local` (local dev) and in your deployment environment (Vercel, Railway, etc.).
3. Ensure `.env.local` is listed in `.gitignore` and never committed.

---

## Patch 2: `app/api/translate/route.js` — Hardcoded Cohere API Key

**Problem:** The file contains a hardcoded Cohere API key (visible in the git history of this repo). This key is now publicly exposed.

**Required change:**

Remove the hardcoded key. Replace any pattern like:

```javascript
const cohereKey = '<YOUR_COHERE_KEY>';
```

With:

```javascript
const cohereKey = process.env.COHERE_API_KEY;
if (!cohereKey) {
  throw new Error('COHERE_API_KEY environment variable is required');
}
```

**Action items:**
1. Go to https://dashboard.cohere.com/api-keys and revoke/rotate the exposed key immediately.
2. Set the new key as `COHERE_API_KEY` in your `.env.local` (local dev) and in your deployment environment.
3. Ensure `.env.local` is listed in `.gitignore` and never committed.

---

## General Security Checklist

- [ ] Rotate AssemblyAI key at https://www.assemblyai.com/dashboard
- [ ] Rotate Cohere key at https://dashboard.cohere.com/api-keys
- [ ] Update `app/api/token/route.js` to use `process.env.ASSEMBLYAI_API_KEY` with no fallback
- [ ] Update `app/api/translate/route.js` to use `process.env.COHERE_API_KEY` with no fallback
- [ ] Verify `.env.local` is in `.gitignore`
- [ ] Audit git history for any other hardcoded secrets (`git log -p | grep -i 'api_key\|secret\|token'`)
- [ ] Consider using a secrets scanning tool (e.g., `git-secrets`, `truffleHog`, or GitHub's built-in secret scanning) to prevent future leaks
