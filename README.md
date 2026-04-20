# improve at osu

A Cloudflare Pages app that lets osu! players log in, analyze their skill profile, and get personalized map recommendations.

**For end users:** one-click "Login with osu!" — no setup, no credentials to manage.
**For you (the owner):** deployed entirely through web dashboards. **Zero CLI tools, zero Node installs.**

---

## File layout

```
ppfarm/
├── functions/           ← backend (runs on Cloudflare's edge)
│   ├── api/
│   │   └── [[path]].js  ← catches all /api/* requests
│   └── _lib/            ← shared modules (underscore = not a route)
│       ├── auth.js
│       ├── osu.js
│       ├── recommender.js
│       └── utils.js
├── public/              ← static frontend
│   ├── index.html
│   ├── app.css
│   └── app.js
├── migrations/
│   └── 0001_initial.sql ← database schema (paste into Cloudflare console)
└── README.md
```

---

## One-time deployment (all in the browser, ~20 min)

### 1. Put the code on GitHub

1. Go to https://github.com/new
2. Name it `ppfarm` → **Private** → don't check any boxes → **Create repository**
3. On the empty repo page, click the **uploading an existing file** link
4. Open your unzipped `ppfarm` folder, select **all files inside** (not the folder itself), drag into the browser
5. Scroll down → **Commit changes**

### 2. Register osu! OAuth app

1. https://osu.ppy.sh/home/account/edit#oauth → **New OAuth Application**
2. Name: `pp.farm`
3. Callback URL: `https://ppfarm.pages.dev/api/auth/callback` (you'll fix this if your actual URL differs)
4. **Register** → copy the **Client ID** and **Client Secret**

### 3. Create Cloudflare account + connect GitHub

1. https://dash.cloudflare.com/sign-up (free, no card)
2. Sidebar → **Workers & Pages** → **Create application** → **Pages** tab → **Connect to Git**
3. Authorize GitHub, pick your `ppfarm` repo
4. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `public`
5. **Save and Deploy**

Cloudflare gives you a URL like `https://ppfarm.pages.dev`.

### 4. Create D1 database + run migration

1. Sidebar → **Workers & Pages** → **D1** → **Create database** → name it `ppfarm`
2. Click into the new database → **Console** tab
3. Open `migrations/0001_initial.sql` in VS Code, copy the entire contents
4. Paste into the D1 console → **Execute**

### 5. Create KV namespace

1. Sidebar → **Workers & Pages** → **KV** → **Create a namespace**
2. Name it `CACHE` → **Add**

### 6. Bind storage to your Pages project

1. Sidebar → **Workers & Pages** → click your `ppfarm` project
2. **Settings** tab → scroll to **Bindings** (or "Functions → Bindings")
3. **Add → KV namespace:**
   - Variable name: `CACHE`
   - KV namespace: pick the one you made
4. **Add → D1 database:**
   - Variable name: `DB`
   - D1 database: pick `ppfarm`

### 7. Add environment variables

Same **Settings** tab → **Variables and Secrets** — add four variables, marked as **Secret**:

| Name | Value |
|---|---|
| `OSU_CLIENT_ID` | Client ID from Step 2 |
| `OSU_CLIENT_SECRET` | Client Secret from Step 2 |
| `OSU_REDIRECT_URI` | `https://ppfarm.pages.dev/api/auth/callback` (your real URL) |
| `SESSION_SECRET` | long random string — get one from https://www.random.org/strings/?num=1&len=64&digits=on&loweralpha=on&unique=on&format=html&rnd=new |

Apply to **Production** environment.

### 8. Verify callback URL matches osu!

If your Cloudflare URL isn't exactly `ppfarm.pages.dev`, edit your osu! OAuth app's callback URL to match. URLs **must match exactly**, including `https://` and full path.

### 9. Redeploy to pick up bindings

- Pages project → **Deployments** tab
- Latest deployment → **...** menu → **Retry deployment**

Wait ~90 seconds. Visit your site. Click "Login with osu!". If OAuth completes and lands you on a working dashboard — you're live.

---

## How to edit code going forward

**Desktop VS Code:** Edit locally → go to github.com/your-username/ppfarm → click the file → pencil icon → paste changes → **Commit**.

**Browser VS Code:** On your GitHub repo, press `.` — the browser turns into VS Code. Edit, go to **Source Control**, commit, push.

Either way, Cloudflare auto-deploys within ~90 seconds.

---

## Troubleshooting

**Deploy fails with "entry-point file at 'src/worker.js' was not found"**
Old Worker-style files confused Cloudflare. Make sure your repo has **no** `wrangler.toml`, **no** `src/` folder, and **no** `package.json`. Only the files shown in the layout above.

**"Login failed: state_mismatch"**
Your `OSU_REDIRECT_URI` doesn't exactly match what's registered with osu!. Check for typos, `http` vs `https`, trailing slashes.

**"D1_ERROR: no such table: users"**
You skipped Step 4 — paste the migration SQL into the D1 console.

**"osu! app auth failed"**
Wrong `OSU_CLIENT_ID` or `OSU_CLIENT_SECRET`.

**Dashboard loads but recommendations stay spinning**
Open browser DevTools → Network tab → refresh → click the red request → **Response** tab. Error message tells you what's missing.

**"Not authenticated" right after logging in**
Check that the `ppfarm_sid` cookie is being set (DevTools → Application → Cookies). If not, `SESSION_SECRET` may be empty or broken.

---

## Cost

| Usage | Cost |
|---|---|
| Up to 100k requests/day | $0 |
| Up to 25M D1 reads/day | $0 |
| Up to 100k KV reads/day | $0 |

A niche osu! tool typically sees 5k–20k requests/day. You'll stay on the free tier indefinitely.

---

## Before launching publicly

1. **Rate-limit** `/api/recommend/public` to prevent scraping of your osu! API quota
2. **Add Cloudflare Turnstile** (free CAPTCHA) to the lookup form
3. **Write a privacy policy** — osu!'s API terms require disclosure

Let me know when you want any of these added — I can write them as drop-in patches.
