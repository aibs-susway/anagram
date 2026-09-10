const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.join(__dirname, 'data.json');
const MAX_DAILY_E_CASH = 100;
const POST_REWARD = 20;
const MESSAGE_REWARD = 10;
const REFERRAL_REWARD = 40;
const FRIEND_REWARD = 20;
const MIN_AUCTION_SECONDS = 15;
const MAX_AUCTION_SECONDS = 14 * 24 * 60 * 60;
const PLINKO_DROP_COST = 1;
const PLINKO_MULTIPLIERS = [0, 0.2, 0.5, 0.8, 1.2, 0.8, 0.5, 0.2, 0];
const STOCKS = [
  { symbol: 'ANAG', name: 'Anagram Labs', price: 25 },
  { symbol: 'CHAT', name: 'ChatWorks', price: 40 },
  { symbol: 'PLAY', name: 'PlayForge', price: 15 },
  { symbol: 'CASH', name: 'Cashline', price: 60 },
  { symbol: 'NOVA', name: 'Nova Systems', price: 90 }
];
const ADMIN_USERNAME = 'despawn';
const ADMIN_PASSWORD = 'TalkingRian';

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          accounts: [],
          posts: [],
          chats: [],
          transfers: [],
          marketplace: [],
          games: [],
          stocks: STOCKS
        },
        null,
        2
      )
    );
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeAccount(account) {
  if (!account) {
    return null;
  }

  const { password, emailVerificationCode, ...safe } = account;
  return safe;
}

function getDefaultStore() {
  return {
    accounts: [],
    posts: [],
    chats: [],
    transfers: [],
    marketplace: [],
    games: [],
    stocks: STOCKS
  };
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ensureAdminAccount(store) {
  const adminCandidates = store.accounts.filter((account) => account.username && account.username.toLowerCase() === ADMIN_USERNAME.toLowerCase());
  let admin = adminCandidates.find((account) => account.isAdmin) || adminCandidates.find((account) => account.id === 'admin-despawn');

  if (!admin) {
    admin = {
      id: 'admin-despawn',
      username: ADMIN_USERNAME,
      email: 'despawn@anagram.local',
      password: ADMIN_PASSWORD,
      eCash: Number.MAX_SAFE_INTEGER,
      profilePicture: '',
      profileDescription: 'System administrator.',
      theme: 'dark',
      isAdmin: true,
      isBanned: false,
      emailVerified: true,
      emailVerificationCode: '',
      referralCode: 'DESPAWNADMIN',
      friends: [],
      createdAt: new Date().toISOString(),
      daily: { date: todayKey(), total: 100, posts: 0, referrals: 0 }
    };

    store.accounts.unshift(admin);
  }

  admin.username = ADMIN_USERNAME;
  admin.email = 'despawn@anagram.local';
  admin.password = ADMIN_PASSWORD;
  admin.eCash = Number.MAX_SAFE_INTEGER;
  admin.isAdmin = true;
  admin.isBanned = false;
  admin.emailVerified = true;
  admin.emailVerificationCode = '';
  admin.profileDescription = admin.profileDescription || 'System administrator.';
  admin.theme = admin.theme || 'dark';
  admin.referralCode = admin.referralCode || 'DESPAWNADMIN';
  admin.friends = Array.isArray(admin.friends) ? admin.friends : [];

  store.accounts = store.accounts.filter((account) => {
    if (account.id === admin.id) {
      return true;
    }

    return !(account.username && account.username.toLowerCase() === ADMIN_USERNAME.toLowerCase() && !account.isAdmin);
  });
}

function loadStore() {
  ensureDataFile();
  const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  const normalized = getDefaultStore();
  normalized.accounts = Array.isArray(store.accounts) ? store.accounts : [];
  normalized.posts = Array.isArray(store.posts) ? store.posts : [];
  normalized.chats = Array.isArray(store.chats) ? store.chats : [];
  normalized.transfers = Array.isArray(store.transfers) ? store.transfers : [];
  normalized.marketplace = Array.isArray(store.marketplace) ? store.marketplace : [];
  normalized.games = Array.isArray(store.games) ? store.games : [];
  normalized.stocks = Array.isArray(store.stocks) && store.stocks.length ? store.stocks : STOCKS.map((stock) => ({ ...stock }));

  normalized.accounts = normalized.accounts.map((account) => ({
    ...account,
    friends: Array.isArray(account.friends) ? account.friends : [],
    stocks: account.stocks && typeof account.stocks === 'object' ? account.stocks : {},
    emailVerified: account.emailVerified !== false,
    emailVerificationCode: account.emailVerificationCode || ''
  }));

  const previousAccountCount = normalized.accounts.length;
  ensureAdminAccount(normalized);

  if (normalized.accounts.length !== previousAccountCount) {
    saveStore(normalized);
  }

  return normalized;
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function findMarketplaceItem(store, itemId) {
  return store.marketplace.find((item) => item.id === itemId);
}

function serializeMarketplace(store, item) {
  const seller = findAccount(store, item.sellerId);
  const highestBidder = item.highestBidderId ? findAccount(store, item.highestBidderId) : null;
  return {
    ...item,
    sellerUsername: seller ? seller.username : 'Unknown seller',
    highestBidderUsername: highestBidder ? highestBidder.username : ''
  };
}

function settleAuctions(store) {
  const now = Date.now();
  let changed = false;

  store.marketplace.forEach((item) => {
    if (item.type !== 'auction' || item.status !== 'active' || new Date(item.endsAt).getTime() > now) {
      return;
    }

    const winner = item.highestBidderId ? findAccount(store, item.highestBidderId) : null;
    const seller = findAccount(store, item.sellerId);

    if (winner && seller && Number(winner.eCash || 0) >= Number(item.currentPrice || 0)) {
      winner.eCash = Number(winner.eCash || 0) - Number(item.currentPrice || 0);
      seller.eCash = Number(seller.eCash || 0) + Number(item.currentPrice || 0);
      item.status = 'sold';
      item.buyerId = winner.id;
      item.soldAt = new Date().toISOString();
    } else {
      item.status = 'ended';
    }

    changed = true;
  });

  return changed;
}

function createMarketplaceItem(store, input) {
  const seller = findAccount(store, input.sellerId);
  if (!seller || seller.isBanned) {
    throw new Error('Seller account not found or banned.');
  }

  const type = input.type === 'auction' ? 'auction' : 'shop';
  const title = normalizeText(input.title);
  const description = normalizeText(input.description);
  const price = Number(input.price);

  if (!title) {
    throw new Error('Offer title is required.');
  }

  if (!Number.isInteger(price) || price <= 0) {
    throw new Error('Price must be a positive whole number.');
  }

  const item = {
    id: randomBytes(8).toString('hex'),
    sellerId: seller.id,
    type,
    title,
    description,
    price,
    startingPrice: price,
    currentPrice: price,
    highestBidderId: '',
    buyerId: '',
    status: 'active',
    createdAt: new Date().toISOString(),
    endsAt: ''
  };

  if (type === 'auction') {
    const durationSeconds = Number(input.durationSeconds);
    if (!Number.isInteger(durationSeconds) || durationSeconds < MIN_AUCTION_SECONDS || durationSeconds > MAX_AUCTION_SECONDS) {
      throw new Error('Auction duration must be between 15 seconds and 2 weeks.');
    }
    item.endsAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
  }

  store.marketplace.unshift(item);
  return item;
}

function buyMarketplaceItem(store, buyerId, itemId) {
  settleAuctions(store);
  const buyer = findAccount(store, buyerId);
  const item = findMarketplaceItem(store, itemId);

  if (!buyer || buyer.isBanned || !item) {
    throw new Error('Buyer or offer not found.');
  }
  if (item.sellerId === buyerId) {
    throw new Error('You cannot buy your own offer.');
  }
  if (item.status !== 'active' || item.type !== 'shop') {
    throw new Error('This shop offer is no longer available.');
  }
  if (!buyer.isAdmin && Number(buyer.eCash || 0) < item.price) {
    throw new Error('Insufficient e-cash balance.');
  }

  if (!buyer.isAdmin) {
    buyer.eCash = Number(buyer.eCash || 0) - item.price;
  }
  const seller = findAccount(store, item.sellerId);
  if (seller && !seller.isAdmin) {
    seller.eCash = Number(seller.eCash || 0) + item.price;
  }
  item.status = 'sold';
  item.buyerId = buyer.id;
  item.soldAt = new Date().toISOString();
  return item;
}

function placeMarketplaceBid(store, bidderId, itemId, amount) {
  settleAuctions(store);
  const bidder = findAccount(store, bidderId);
  const item = findMarketplaceItem(store, itemId);
  const bid = Number(amount);

  if (!bidder || bidder.isBanned || !item) {
    throw new Error('Bidder or offer not found.');
  }
  if (item.sellerId === bidderId) {
    throw new Error('You cannot bid on your own auction.');
  }
  if (item.type !== 'auction' || item.status !== 'active' || new Date(item.endsAt).getTime() <= Date.now()) {
    throw new Error('This auction is no longer active.');
  }
  if (!Number.isInteger(bid) || bid <= Number(item.currentPrice || 0)) {
    throw new Error('Bid must be higher than the current price.');
  }
  if (!bidder.isAdmin && Number(bidder.eCash || 0) < bid) {
    throw new Error('Insufficient e-cash balance for this bid.');
  }

  item.currentPrice = bid;
  item.price = bid;
  item.highestBidderId = bidder.id;
  return item;
}

function getGameRoom(store, roomId) {
  return store.games.find((room) => room.id === roomId);
}

function createGameRoom(store, accountId, input) {
  const account = findAccount(store, accountId);
  const type = ['holdem', 'blackjack'].includes(input.type) ? input.type : 'holdem';
  const wager = Number(input.wager);
  if (!account || account.isBanned) throw new Error('Account not found or banned.');
  if (!Number.isInteger(wager) || wager < 1) throw new Error('Wager must be a positive whole number.');
  if (!account.isAdmin && Number(account.eCash || 0) < wager) throw new Error('Insufficient e-cash balance.');

  const room = {
    id: randomBytes(5).toString('hex'),
    type,
    wager,
    hostId: accountId,
    players: [accountId],
    status: 'waiting',
    createdAt: new Date().toISOString(),
    result: null
  };
  store.games.unshift(room);
  return room;
}

function joinGameRoom(store, accountId, roomId) {
  const account = findAccount(store, accountId);
  const room = getGameRoom(store, roomId);
  if (!account || account.isBanned || !room) throw new Error('Account or game room not found.');
  if (room.status !== 'waiting') throw new Error('This game is already in progress or finished.');
  if (!room.players.includes(accountId)) {
    if (room.players.length >= 6) throw new Error('This game room is full.');
    if (!account.isAdmin && Number(account.eCash || 0) < room.wager) throw new Error('Insufficient e-cash balance.');
    room.players.push(accountId);
  }
  return room;
}

function playGameRoom(store, accountId, roomId) {
  const room = getGameRoom(store, roomId);
  if (!room || !room.players.includes(accountId)) throw new Error('You are not in this game room.');
  if (room.players.length < 2) throw new Error('At least two players are required.');
  if (room.status === 'finished') return room;

  room.players.forEach((playerId) => {
    const player = findAccount(store, playerId);
    if (player && !player.isAdmin) {
      if (Number(player.eCash || 0) < room.wager) throw new Error('A player no longer has enough e-cash for this wager.');
      player.eCash -= room.wager;
    }
  });

  room.status = 'finished';
  const winnerId = room.players[Math.floor(Math.random() * room.players.length)];
  const prize = room.wager * room.players.length;
  const winner = findAccount(store, winnerId);
  if (winner && !winner.isAdmin) winner.eCash = Number(winner.eCash || 0) + prize;
  room.result = { winnerId, prize, message: `${room.type === 'holdem' ? 'Texas Hold-em' : 'Blackjack'} winner selected.` };
  return room;
}

function playPlinko(store, accountId) {
  const account = findAccount(store, accountId);
  if (!account || account.isBanned) throw new Error('Account not found or banned.');
  if (!account.isAdmin && Number(account.eCash || 0) < PLINKO_DROP_COST) throw new Error('You need 1 e-cash to drop a chip.');
  if (!account.isAdmin) account.eCash = Number(account.eCash || 0) - PLINKO_DROP_COST;
  const slot = Math.floor(Math.random() * PLINKO_MULTIPLIERS.length);
  const payout = Math.floor(PLINKO_DROP_COST * PLINKO_MULTIPLIERS[slot]);
  if (!account.isAdmin) account.eCash += payout;
  return { slot, multiplier: PLINKO_MULTIPLIERS[slot], cost: PLINKO_DROP_COST, payout };
}

function playRoulette(store, accountId, input) {
  const account = findAccount(store, accountId);
  const wager = Number(input.amount);
  if (!account || account.isBanned) throw new Error('Account not found or banned.');
  if (!Number.isInteger(wager) || wager < 1) throw new Error('Roulette wager must be a positive whole number.');
  if (!account.isAdmin && Number(account.eCash || 0) < wager) throw new Error('Insufficient e-cash balance.');
  if (!account.isAdmin) account.eCash -= wager;
  const number = Math.floor(Math.random() * 37);
  const won = input.choice === 'red' ? number !== 0 && number % 2 === 1 : input.choice === 'black' ? number !== 0 && number % 2 === 0 : Number(input.choice) === number;
  const multiplier = Number(input.choice) === number ? 35 : won ? 1 : 0;
  const payout = wager * multiplier;
  if (!account.isAdmin) account.eCash += payout;
  return { number, choice: input.choice, payout, multiplier };
}

function tradeStock(store, accountId, input) {
  const account = findAccount(store, accountId);
  const stock = store.stocks.find((entry) => entry.symbol === input.symbol);
  const quantity = Number(input.quantity);
  const side = input.side === 'sell' ? 'sell' : 'buy';
  if (!account || account.isBanned || !stock) throw new Error('Account or stock not found.');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be a positive whole number.');
  account.stocks = account.stocks || {};
  const held = Number(account.stocks[stock.symbol] || 0);
  if (side === 'buy') {
    const cost = stock.price * quantity;
    if (!account.isAdmin && Number(account.eCash || 0) < cost) throw new Error('Insufficient e-cash balance.');
    if (!account.isAdmin) account.eCash -= cost;
    account.stocks[stock.symbol] = held + quantity;
  } else {
    if (held < quantity) throw new Error('You do not own enough shares.');
    account.stocks[stock.symbol] = held - quantity;
    if (!account.isAdmin) account.eCash += stock.price * quantity;
  }
  return { stock, side, quantity, shares: account.stocks };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
    });

    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        try {
          const params = new URLSearchParams(raw);
          resolve(Object.fromEntries(params.entries()));
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      }
    });

    req.on('error', reject);
  });
}

function getDailyProgress(account) {
  const today = todayKey();

  if (!account.daily || account.daily.date !== today) {
    account.daily = {
      date: today,
      total: 0,
      posts: 0,
      referrals: 0,
      friends: 0
    };
  }

  account.daily.posts = Number(account.daily.posts || 0);
  account.daily.referrals = Number(account.daily.referrals || 0);
  account.daily.friends = Number(account.daily.friends || 0);

  return account.daily;
}

function applyDailyReward(account, questType, amount) {
  if (account.isAdmin) {
    return 0;
  }

  const daily = getDailyProgress(account);
  const remaining = MAX_DAILY_E_CASH - daily.total;

  if (remaining <= 0) {
    return 0;
  }

  const awarded = Math.min(amount, remaining);
  account.eCash = Number(account.eCash || 0) + awarded;
  daily.total += awarded;
  daily.date = todayKey();

  if (questType === 'post') {
    daily.posts = Number(daily.posts || 0) + 1;
  }

  if (questType === 'referral') {
    daily.referrals = Number(daily.referrals || 0) + 1;
  }

  if (questType === 'friend') {
    daily.friends = Number(daily.friends || 0) + 1;
  }

  account.daily = daily;
  return awarded;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function findAccount(store, accountId) {
  return store.accounts.find((account) => account.id === accountId);
}

function createAccount(store, input) {
  const username = normalizeText(input.username);
  const email = normalizeText(input.email).toLowerCase();
  const password = normalizeText(input.password);
  const referralCode = normalizeText(input.referralCode || '').toUpperCase();

  if (!username || username.length < 3) {
    throw new Error('Username must be at least 3 characters long.');
  }

  if (username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
    throw new Error('That username is reserved for the administrator.');
  }

  if (!password) {
    throw new Error('Password is required.');
  }

  if (!isValidEmail(email)) {
    throw new Error('Please provide a valid email address.');
  }

  if (store.accounts.some((account) => account.email.toLowerCase() === email)) {
    throw new Error('Only one account per email address is allowed.');
  }

  const account = {
    id: randomBytes(8).toString('hex'),
    username,
    email,
    password,
    eCash: 0,
    profilePicture: '',
    profileDescription: '',
    theme: 'light',
    isAdmin: false,
    isBanned: false,
    emailVerified: true,
    emailVerificationCode: '',
    referralCode: referralCode || randomBytes(4).toString('hex').toUpperCase(),
    friends: [],
    stocks: {},
    createdAt: new Date().toISOString(),
    daily: {
      date: todayKey(),
      total: 0,
      posts: 0,
      referrals: 0,
      friends: 0,
      friends: 0
    }
  };

  store.accounts.push(account);

  if (referralCode) {
    const referrer = store.accounts.find((entry) => entry.referralCode === referralCode && entry.id !== account.id);
    if (referrer) {
      applyDailyReward(referrer, 'referral', REFERRAL_REWARD);
    }
  }

  return account;
}

function verifyAccount(store, email, code) {
  const account = store.accounts.find((entry) => entry.email.toLowerCase() === email.toLowerCase());

  if (!account) {
    throw new Error('Account not found.');
  }

  if (account.emailVerified) {
    return account;
  }

  if (code && account.emailVerificationCode !== String(code)) {
    throw new Error('Invalid verification code.');
  }

  account.emailVerified = true;
  account.emailVerificationCode = '';
  return account;
}

function loginAccount(store, identifier, password) {
  const lookup = normalizeText(identifier || '').toLowerCase();
  const account = store.accounts.find((entry) => (
    entry.email.toLowerCase() === lookup || entry.username.toLowerCase() === lookup
  ));

  if (!account) {
    throw new Error('Account not found.');
  }

  if (account.isBanned) {
    throw new Error('This account has been banned.');
  }

  if (account.password !== password) {
    throw new Error('Incorrect password.');
  }

  account.emailVerified = true;
  account.emailVerificationCode = '';
  return account;
}

function updateProfile(store, accountId, input) {
  const account = findAccount(store, accountId);

  if (!account) {
    throw new Error('Account not found.');
  }

  if (input.profilePicture !== undefined) {
    account.profilePicture = normalizeText(input.profilePicture);
  }

  if (input.profileDescription !== undefined) {
    account.profileDescription = normalizeText(input.profileDescription);
  }

  if (input.theme) {
    account.theme = ['light', 'dark', 'high-contrast'].includes(input.theme) ? input.theme : 'light';
  }

  return account;
}

function addFriend(store, accountId, friendId) {
  const account = findAccount(store, accountId);
  const friend = findAccount(store, friendId);

  if (!account || !friend) {
    throw new Error('Account not found.');
  }

  if (accountId === friendId) {
    throw new Error('You cannot add yourself as a friend.');
  }

  const alreadyFriends = (account.friends || []).includes(friendId);

  if (!alreadyFriends) {
    account.friends = Array.from(new Set([...(account.friends || []), friendId]));
    friend.friends = Array.from(new Set([...(friend.friends || []), accountId]));
    applyDailyReward(account, 'friend', FRIEND_REWARD);
  }

  return { account, friend };
}

function createPost(store, accountId, text) {
  const account = findAccount(store, accountId);

  if (!account) {
    throw new Error('Account not found.');
  }

  if (account.isBanned) {
    throw new Error('This account has been banned.');
  }

  const cleanText = normalizeText(text);
  if (!cleanText) {
    throw new Error('Post text cannot be empty.');
  }

  const reward = applyDailyReward(account, 'post', POST_REWARD);

  const post = {
    id: randomBytes(8).toString('hex'),
    accountId: account.id,
    text: cleanText,
    createdAt: new Date().toISOString(),
    comments: [],
    questAward: reward
  };

  store.posts.unshift(post);
  return post;
}

function addComment(store, postId, accountId, text) {
  const post = store.posts.find((entry) => entry.id === postId);
  if (!post) {
    throw new Error('Post not found.');
  }

  const account = findAccount(store, accountId);
  if (!account || account.isBanned) {
    throw new Error('Account not found or banned.');
  }

  const cleanText = normalizeText(text);
  if (!cleanText) {
    throw new Error('Comment text cannot be empty.');
  }

  const comment = {
    id: randomBytes(8).toString('hex'),
    postId,
    accountId,
    text: cleanText,
    createdAt: new Date().toISOString()
  };

  post.comments.push(comment);
  return comment;
}

function createTransfer(store, senderId, recipientId, amount) {
  const sender = findAccount(store, senderId);
  const recipient = findAccount(store, recipientId);

  if (!sender || !recipient) {
    throw new Error('Sender or recipient account not found.');
  }

  if (sender.isBanned || recipient.isBanned) {
    throw new Error('A banned account cannot send or receive e-cash.');
  }

  if (senderId === recipientId) {
    throw new Error('You cannot send e-cash to yourself.');
  }

  const parsedAmount = Number(amount);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Amount must be a positive integer.');
  }

  if (!sender.isAdmin && sender.eCash < parsedAmount) {
    throw new Error('Insufficient e-cash balance.');
  }

  sender.eCash = Number(sender.eCash || 0) - parsedAmount;
  recipient.eCash = Number(recipient.eCash || 0) + parsedAmount;

  const transfer = {
    id: randomBytes(8).toString('hex'),
    senderId,
    recipientId,
    amount: parsedAmount,
    createdAt: new Date().toISOString()
  };

  store.transfers.unshift(transfer);
  return transfer;
}

function createChat(store, accountId, input) {
  const account = findAccount(store, accountId);
  if (!account || account.isBanned) {
    throw new Error('Account not found or banned.');
  }

  const type = input.type === 'group' ? 'group' : 'dm';
  const requestedParticipants = Array.isArray(input.participants) ? input.participants : [];
  const uniqueParticipants = [...new Set([accountId, ...requestedParticipants])];

  if (type === 'dm' && uniqueParticipants.length !== 2) {
    throw new Error('Direct messages must have exactly two participants.');
  }

  const chat = {
    id: randomBytes(8).toString('hex'),
    type,
    name: type === 'group' ? normalizeText(input.name) || 'Group Chat' : account.username,
    participants: uniqueParticipants,
    messages: [],
    createdAt: new Date().toISOString()
  };

  store.chats.unshift(chat);
  return chat;
}

function addChatMessage(store, chatId, accountId, text) {
  const chat = store.chats.find((entry) => entry.id === chatId);
  if (!chat) {
    throw new Error('Chat not found.');
  }

  const account = findAccount(store, accountId);
  if (!account || account.isBanned) {
    throw new Error('Account not found or banned.');
  }

  if (!chat.participants.includes(accountId)) {
    throw new Error('Account is not a participant in this chat.');
  }

  const cleanText = normalizeText(text);
  if (!cleanText) {
    throw new Error('Message text cannot be empty.');
  }

  const message = {
    id: randomBytes(8).toString('hex'),
    accountId,
    text: cleanText,
    createdAt: new Date().toISOString()
  };

  chat.messages.push(message);

  if (!account.isAdmin) {
    applyDailyReward(account, 'message', MESSAGE_REWARD);
  }

  return message;
}

function setBanState(store, requesterId, targetId, banned) {
  const requester = findAccount(store, requesterId);
  if (!requester || !requester.isAdmin) {
    throw new Error('Only the admin account can ban users.');
  }

  const target = findAccount(store, targetId);
  if (!target) {
    throw new Error('Target account not found.');
  }

  if (target.id === requester.id || target.isAdmin) {
    throw new Error('The admin account cannot be banned.');
  }

  target.isBanned = Boolean(banned);
  return target;
}

function deleteAccount(store, requesterId, targetId) {
  const requester = findAccount(store, requesterId);
  if (!requester || !requester.isAdmin) {
    throw new Error('Only the admin account can delete users.');
  }

  const target = findAccount(store, targetId);
  if (!target) {
    throw new Error('Target account not found.');
  }

  if (target.id === requester.id || target.isAdmin) {
    throw new Error('The admin account cannot be deleted.');
  }

  store.accounts.forEach((account) => {
    account.friends = (account.friends || []).filter((friendId) => friendId !== targetId);
  });

  store.accounts = store.accounts.filter((account) => account.id !== targetId);
  store.posts = store.posts.filter((post) => post.accountId !== targetId);
  store.posts.forEach((post) => {
    post.comments = (post.comments || []).filter((comment) => comment.accountId !== targetId);
  });
  store.chats = store.chats
    .map((chat) => ({
      ...chat,
      participants: (chat.participants || []).filter((participantId) => participantId !== targetId)
    }))
    .filter((chat) => (chat.participants || []).length >= 2);
  store.transfers = store.transfers.filter(
    (transfer) => transfer.senderId !== targetId && transfer.recipientId !== targetId
  );

  return target;
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    sendHtml(res, 200, html);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  const store = loadStore();

  if (req.method === 'GET' && url.pathname === '/api/accounts') {
    sendJson(res, 200, { accounts: store.accounts.filter((account) => !account.isAdmin).map(sanitizeAccount) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/posts') {
    sendJson(res, 200, { posts: store.posts });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/chats') {
    const accountId = url.searchParams.get('accountId');
    const chats = accountId
      ? store.chats.filter((chat) => (chat.participants || []).includes(accountId))
      : store.chats;
    const chatsWithUsernames = chats.map((chat) => ({
      ...chat,
      messages: (chat.messages || []).map((message) => ({
        ...message,
        username: findAccount(store, message.accountId)?.username || 'Deleted user'
      }))
    }));
    sendJson(res, 200, { chats: chatsWithUsernames });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/marketplace') {
    const changed = settleAuctions(store);
    if (changed) {
      saveStore(store);
    }
    sendJson(res, 200, { items: store.marketplace.map((item) => serializeMarketplace(store, item)) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/games') {
    sendJson(res, 200, { games: store.games.filter((room) => room.status === 'waiting').map((room) => ({ ...room, hostUsername: findAccount(store, room.hostId)?.username || 'Unknown' })) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/stocks') {
    sendJson(res, 200, { stocks: store.stocks });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    const leaderboard = store.accounts
      .filter((account) => !account.isAdmin)
      .sort((a, b) => Number(b.eCash) - Number(a.eCash))
      .slice(0, 10)
      .map((account) => ({
        id: account.id,
        username: account.username,
        profilePicture: account.profilePicture || '',
        eCash: Number(account.eCash || 0),
        friends: account.friends || [],
        isBanned: account.isBanned,
        isAdmin: account.isAdmin
      }));

    sendJson(res, 200, { leaderboard });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/accounts') {
    try {
      const body = await readBody(req);
      const account = createAccount(store, body);
      saveStore(store);
      sendJson(res, 201, {
        account: sanitizeAccount(account),
        message: 'Account created successfully.'
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/accounts/verify') {
    try {
      const body = await readBody(req);
      const account = verifyAccount(store, body.email, body.code);
      saveStore(store);
      sendJson(res, 200, { account: sanitizeAccount(account) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    try {
      const body = await readBody(req);
      const account = loginAccount(store, body.identifier || body.email || body.username, body.password);
      saveStore(store);
      sendJson(res, 200, { account: sanitizeAccount(account) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/accounts/')) {
    try {
      const accountId = url.pathname.split('/api/accounts/')[1];
      const body = await readBody(req);
      const account = updateProfile(store, accountId, body);
      saveStore(store);
      sendJson(res, 200, { account: sanitizeAccount(account) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/friends') {
    try {
      const body = await readBody(req);
      const { account, friend } = addFriend(store, body.accountId, body.friendId);
      saveStore(store);
      sendJson(res, 200, {
        account: sanitizeAccount(account),
        friend: sanitizeAccount(friend)
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/posts') {
    try {
      const body = await readBody(req);
      const post = createPost(store, body.accountId, body.text);
      saveStore(store);
      sendJson(res, 201, { post });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/posts/') && url.pathname.endsWith('/comments')) {
    try {
      const postId = url.pathname.split('/api/posts/')[1].split('/comments')[0];
      const body = await readBody(req);
      const comment = addComment(store, postId, body.accountId, body.text);
      saveStore(store);
      sendJson(res, 201, { comment });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/transfers') {
    try {
      const body = await readBody(req);
      const transfer = createTransfer(store, body.senderId, body.recipientId, body.amount);
      saveStore(store);
      sendJson(res, 201, { transfer });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chats') {
    try {
      const body = await readBody(req);
      const chat = createChat(store, body.accountId, body);
      saveStore(store);
      sendJson(res, 201, { chat });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/marketplace') {
    try {
      const body = await readBody(req);
      const item = createMarketplaceItem(store, body);
      saveStore(store);
      sendJson(res, 201, { item: serializeMarketplace(store, item) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/games') {
    try {
      const body = await readBody(req);
      const room = createGameRoom(store, body.accountId, body);
      saveStore(store);
      sendJson(res, 201, { game: room });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/games/') && url.pathname.endsWith('/join')) {
    try {
      const roomId = url.pathname.split('/api/games/')[1].split('/join')[0];
      const body = await readBody(req);
      const room = joinGameRoom(store, body.accountId, roomId);
      saveStore(store);
      sendJson(res, 200, { game: room });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/games/') && url.pathname.endsWith('/play')) {
    try {
      const roomId = url.pathname.split('/api/games/')[1].split('/play')[0];
      const body = await readBody(req);
      const room = playGameRoom(store, body.accountId, roomId);
      saveStore(store);
      sendJson(res, 200, { game: room });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/games/plinko') {
    try {
      const body = await readBody(req);
      const result = playPlinko(store, body.accountId);
      saveStore(store);
      sendJson(res, 200, { result });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/games/roulette') {
    try {
      const body = await readBody(req);
      const result = playRoulette(store, body.accountId, body);
      saveStore(store);
      sendJson(res, 200, { result });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/stocks/trade') {
    try {
      const body = await readBody(req);
      const result = tradeStock(store, body.accountId, body);
      saveStore(store);
      sendJson(res, 200, { result });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/marketplace/') && url.pathname.endsWith('/buy')) {
    try {
      const itemId = url.pathname.split('/api/marketplace/')[1].split('/buy')[0];
      const body = await readBody(req);
      const item = buyMarketplaceItem(store, body.accountId, itemId);
      saveStore(store);
      sendJson(res, 200, { item: serializeMarketplace(store, item) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/marketplace/') && url.pathname.endsWith('/bid')) {
    try {
      const itemId = url.pathname.split('/api/marketplace/')[1].split('/bid')[0];
      const body = await readBody(req);
      const item = placeMarketplaceBid(store, body.accountId, itemId, body.amount);
      saveStore(store);
      sendJson(res, 200, { item: serializeMarketplace(store, item) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/chats/') && url.pathname.endsWith('/messages')) {
    try {
      const chatId = url.pathname.split('/api/chats/')[1].split('/messages')[0];
      const body = await readBody(req);
      const message = addChatMessage(store, chatId, body.accountId, body.text);
      saveStore(store);
      sendJson(res, 201, { message });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/ban') {
    try {
      const body = await readBody(req);
      const account = setBanState(store, body.requesterId, body.accountId, body.banned);
      saveStore(store);
      sendJson(res, 200, { account: sanitizeAccount(account) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/delete') {
    try {
      const body = await readBody(req);
      const account = deleteAccount(store, body.requesterId, body.accountId);
      saveStore(store);
      sendJson(res, 200, { account: sanitizeAccount(account) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Anagram running on port ${PORT}`);
});
