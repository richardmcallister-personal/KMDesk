# Deputy CEO Desk — deploying to km.richardmcallister.app

Static-assets Worker, the same shape as `footballregister` on your account. No
build step: `public/` is served as-is.

## The repo carries no desk content

`public/index.html` is now the shell only — layout, logic, fonts, wordmarks.
Every name, commitment, project, decision and figure lives in
**`public/data/desk.json`**, which is in `.gitignore` and never committed.
`public/data/desk.sample.json` shows the shape with no real values.

So the repo is safe to hold. Verified before handover: the committed HTML
contains no colleague or counterparty name, no Outlook link, and none of the
figures.

`desk.json` itself is a different matter — it has every commitment, the legal
and HR items, the confidential workstreams, and the group financials. It has to reach the Worker without going through git, and it must sit
behind authentication once it does. Both are below.

## One thing to decide first

`km.richardmcallister.app` is your personal domain. The content is KEVIN.MURPHY
confidential — legal matters, HR decisions, a confidential market-entry
workstream, and group financials. Behind Cloudflare Access with a policy only
you can pass, the technical exposure is small. The governance question is
separate from the technical one, and you are the Legal Officer: company
confidential data on a director's personal apex is the kind of thing you would
want flagged if someone else did it. A KM-controlled hostname avoids the
question entirely. Your call, but make it deliberately.

## 1. Push

```bash
cd km-desk
git init -b main
git add .
git commit -m "Deputy CEO Desk mobile app"
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

Confirm `desk.json` did not go with it:

```bash
git ls-files public/data/
# should print only: public/data/desk.sample.json
```

## 2. Cloudflare Access — before the first deploy, not after

A Worker is on the public internet the moment it deploys, so add the policy
first. Access runs ahead of the Worker, so nothing is reachable unauthenticated.

Zero Trust → Access → Applications → Add a self-hosted application:

- **Application domain:** `km.richardmcallister.app`
- **Session duration:** 24 hours. Shorter and the installed app will throw you
  into a browser sign-in sheet on the train.
- **Policy:** Allow → Emails → `rmcallister@kevinmurphy.com.au` (and your
  personal address if you want it on a second device)

Also add a policy for `km-desk.<your-subdomain>.workers.dev`, or disable that
route in step 4. It is guessable and is not covered by a hostname policy.

## 3. Deploy

```bash
npm install
npx wrangler deploy
```

Or push to `main` and let the Action run it, with two repo secrets:

- `CLOUDFLARE_API_TOKEN` — scoped token, not the global key. *Workers Scripts:
  Edit* and *Account Settings: Read*
- `CLOUDFLARE_ACCOUNT_ID` — from the dashboard sidebar

The workflow fails the deploy if `public/` changed without `CACHE` being bumped
in `public/service-worker.js`. Without that bump, installed phones keep serving
the shell they already cached. It is currently `km-desk-v7`.

## 4. Hostname

Workers → `km-desk` → Settings → Domains & Routes → Add custom domain →
`km.richardmcallister.app`. The zone has to be on the same Cloudflare account.
While you are there, remove the `workers.dev` route.

## 5. Getting desk.json onto it

The desk lives in Workers KV (namespace `km-desk-data`, binding `DESK`, key
`desk.json`), not in `public/`. `src/worker.js` serves `/data/desk.json` from KV
with `Cache-Control: private, no-store`; everything else comes from `public/`.
`public/.assetsignore` stops a stray local `desk.json` ever shipping as a static
file.

### How the scheduled rebuild writes it

The rebuild is a Claude scheduled task in a fresh cloud sandbox, so it has no
repo, no wrangler and should hold no Cloudflare API token (a KV-write token
covers every namespace on the account, and a task prompt is stored in plain
text). It writes through the Worker instead:

```bash
curl -sS -X PUT "https://km-ingest.richardmcallister.app/desk" \
  -H "Authorization: Bearer $DESK_WRITE_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @desk.json
# → {"ok":true,"written":"…","counts":{"owe":19,"owed":5,"prj":16,"dec":6}}
```

`km-ingest.richardmcallister.app` is deliberately outside Access and answers
only `PUT /desk` with the right key; everything else is 404. The key can
overwrite the desk but cannot read it. The Worker rejects anything that is not
JSON with `owe`, `owed`, `prj` and `dec` lists, so a broken run cannot blank
the app. Add a top-level `"built"` ISO timestamp and the app shows that as the
rebuild time; otherwise it shows the write time.

Rotate the key (and update the task) with:

```bash
npx wrangler secret put DESK_WRITE_KEY
```

### By hand

```bash
npm run desk:put -- path/to/desk.json
```

That checks the file is valid JSON and writes it straight to KV using your own
wrangler login.

Because the data is no longer in the deploy, pushing to `main` is now safe: the
Action ships code only. Add the two repo secrets when you want it to deploy.

## What the app does when the data is missing

It does not pretend. Until the fetch resolves, each list shows *Reading the
desk…*; if it fails, *Could not read the desk* with the reason. The service
worker fetches `desk.json` from the network first and keeps the last good copy,
so the app shows each rebuild when online and still opens offline.

## In the box

```
wrangler.jsonc                 Worker config, assets from ./public, KV binding
package.json                   wrangler only
.github/workflows/deploy.yml   deploy on push to main, with the cache-bump guard
.gitignore                     excludes public/data/desk.json
public/index.html              the shell, no desk content
src/worker.js                  serves /data/desk.json from KV
scripts/put-desk.sh            npm run desk:put — writes the desk to KV
public/.assetsignore           keeps desk.json out of static assets
public/data/desk.sample.json   the shape, committed
public/service-worker.js       precache + offline, cache km-desk-v7
public/manifest.webmanifest    installable, standalone, shortcuts
public/fonts /img /icons       Murphy Sans, wordmarks, app tiles
```
