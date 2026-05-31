const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;

export default async function handler(req, res) {
  if (!TOKEN || !OWNER || !REPO) return res.status(500).json({ error: 'GitHub env vars not configured' });

  const { path, method, body } = req.body || {};
  if (!path) return res.status(400).json({ error: 'path required' });

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const ghMethod = method || 'GET';
  const opts = {
    method: ghMethod,
    headers: { 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
  };
  if (ghMethod === 'PUT' && body) opts.body = JSON.stringify(body);

  const r = await fetch(url, opts);
  const data = await r.json();
  if (!r.ok) return res.status(r.status).json({ ...data, _debug_url: url, _owner: OWNER, _repo: REPO });
  res.status(r.status).json(data);
}
