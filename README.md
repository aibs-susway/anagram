# Anagram Social

A lightweight social app with persistent JSON storage, email-based account creation, login, daily e-cash rewards, messaging, profile customization, comments, leaderboard, admin moderation, and theme selection.

## Features

- Email-based account creation with a one-account-per-email rule
- Email verification before login
- Login with username/password
- Persistent local storage in `data.json`
- Daily e-cash rewards up to 100 per day
- Posting messages and adding comments on posts
- Sending e-cash to other users
- Creating direct-message and group chats
- Profile picture and profile description support
- Admin account (`despawn` / `TalkingRian`) with infinite e-cash and ban controls
- Leaderboard that excludes the admin account
- Theme options: Light, Dark, and High Contrast

## Run locally

```bash
node server.js
```

Then open:

- http://localhost:3000

## Default admin account

- Username: `despawn`
- Password: `TalkingRian`

## Main API routes

### Create account

POST `/api/accounts`

Request body:

```json
{
  "username": "jane",
  "email": "jane@example.com",
  "password": "secure-password",
  "referralCode": "OPTIONAL"
}
```

Response includes the generated verification code.

### Verify email

POST `/api/accounts/verify`

```json
{
  "email": "jane@example.com",
  "code": "123456"
}
```

### Login

POST `/api/login`

```json
{
  "email": "jane@example.com",
  "password": "secure-password"
}
```

### Create post

POST `/api/posts`

```json
{
  "accountId": "ACCOUNT_ID",
  "text": "Hello everyone!"
}
```

### Add comment

POST `/api/posts/:postId/comments`

```json
{
  "accountId": "ACCOUNT_ID",
  "text": "Nice post"
}
```

### Create chat

POST `/api/chats`

```json
{
  "accountId": "ACCOUNT_ID",
  "type": "dm",
  "participants": ["OTHER_ACCOUNT_ID"]
}
```

### Send chat message

POST `/api/chats/:chatId/messages`

```json
{
  "accountId": "ACCOUNT_ID",
  "text": "Hello there"
}
```

### Send e-cash

POST `/api/transfers`

```json
{
  "senderId": "ACCOUNT_ID",
  "recipientId": "OTHER_ACCOUNT_ID",
  "amount": 25
}
```

### Admin ban/unban

POST `/api/admin/ban`

```json
{
  "requesterId": "ADMIN_ACCOUNT_ID",
  "accountId": "TARGET_ACCOUNT_ID",
  "banned": true
}
```

## Files

- `server.js` — main Node.js server and API logic
- `index.html` — browser UI for the social app
- `data.json` — persistent account, post, chat, and transfer data

## Notes

- The app stores data locally on disk, so account and social activity persist between restarts.
- The leaderboard is sorted by e-cash and excludes the admin account.
- The admin account is automatically restored if missing from `data.json`.

## Deploying to Azure App Service

The app is a plain Node.js HTTP server (no dependencies), so deployment only needs
Azure to run the right Node version and launch `server.js`.

### Requirements handled in this repo

- `package.json` declares `"engines": { "node": ">=18.0.0" }`. The server uses the
  built-in global `fetch`, which **requires Node 18 or newer**. App Service picks
  its Node version from this field (or from the `WEBSITE_NODE_DEFAULT_VERSION`
  App Setting) — without it Azure may run an old Node and the app crashes on start.
- `web.config` — required for **Windows** App Service. It registers the `iisnode`
  handler and rewrites all requests to `server.js`. Without it, IIS returns a 500 /
  directory error instead of starting the app.
- `iisnode.yml` — pins the iisnode runtime to `NODE_ENV=production` and enables logs
  under `iisnode/`.
- `.deployment` — tells Kudu to run `npm install --production` during deployment.
- `.github/workflows/main_aibs-anagram.yml` — builds with Node 22.x. the app
  server passes. `npm run test --if-present` is used, and a clean `deploy/`
  folder (without `.git`, `node_modules`, or `data.json`) is uploaded and deployed.

### App Settings to confirm in the Azure portal

For the Web App `aibs-anagram`, under **Configuration → Application settings**:

- `WEBSITE_NODE_DEFAULT_VERSION` = `~22` (Windows) — match the version used at build time.
- `SCM_DO_BUILD_DURING_DEPLOYMENT` = `true`.
- The app reads `PORT` automatically; App Service injects it, so do not hardcode it.

### Linux App Service (alternative)

If the App Service is Linux rather than Windows, set the runtime stack to
**Node 22 LTS** and a startup command of `node server.js`. The `web.config` and
`iisnode.yml` files are ignored on Linux and can stay in the repo harmlessly.

### A note on file encoding

Keep every source file UTF-8 **without a BOM**. A byte-order mark at the top of a
`.js` file causes `SyntaxError: Invalid or unexpected token` on older Node runtimes
and an invalid-JSON error for `package.json`.