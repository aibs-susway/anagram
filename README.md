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
