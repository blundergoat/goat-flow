# Express/Node.js Security Standards

Reference for generating `ai/instructions/security.md` in Express or Node.js API projects.

## Helmet Middleware

Helmet sets security headers with sensible defaults. Install and use it first.

```js
// DO — use helmet with all defaults
import helmet from 'helmet';
app.use(helmet());

// DO — customize CSP for your needs
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "https://api.example.com"],
      frameAncestors: ["'none'"],
    },
  },
}));

// DON'T — no security headers
const app = express();
// ... no helmet, no manual headers
```

- Helmet covers: CSP, X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy, and more.
- Always customize `contentSecurityPolicy` to match your application's needs.

## Rate Limiting

```js
// DO — rate limit with express-rate-limit
import rateLimit from 'express-rate-limit';

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,    // 1 minute
  max: 100,                // 100 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                     // 10 attempts
  message: { error: 'Too many login attempts, try again later' },
});

app.use(generalLimiter);
app.post('/auth/login', authLimiter, loginHandler);

// DON'T — no rate limiting on auth endpoints
app.post('/auth/login', loginHandler);
```

- Use a persistent store (Redis) for rate limiting in multi-instance deployments.
- Apply stricter limits to auth, password reset, and OTP endpoints.

## CORS Configuration

```js
// DO — explicit origin whitelist
import cors from 'cors';

const allowedOrigins = ['https://app.example.com', 'https://admin.example.com'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// DON'T — wildcard or reflect origin
app.use(cors({ origin: '*' }));
app.use(cors({ origin: true }));  // reflects any origin — equivalent to wildcard with credentials
```

## Prototype Pollution

```js
// DO — validate and sanitize object inputs
function mergeConfig(defaults, userInput) {
  const safe = {};
  for (const key of Object.keys(defaults)) {
    if (key in userInput) {
      safe[key] = userInput[key];
    } else {
      safe[key] = defaults[key];
    }
  }
  return safe;
}

// DON'T — deep merge user input without sanitization
const config = _.merge({}, defaults, req.body);  // prototype pollution via __proto__

// DON'T — allow __proto__ or constructor in input
Object.assign(target, userInput);  // if userInput has __proto__, it pollutes
```

- Reject or strip keys: `__proto__`, `constructor`, `prototype` from all user-provided objects.
- Use `Object.create(null)` for lookup maps to avoid prototype chain issues.

## ReDoS Prevention

```js
// DO — use safe regex patterns, limit input length
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;  // simple, no backtracking

function validateInput(input) {
  if (input.length > 1000) throw new Error('Input too long');
  return EMAIL_RE.test(input);
}

// DON'T — vulnerable regex patterns with nested quantifiers
const EVIL_RE = /^(a+)+$/;          // exponential backtracking
const EVIL2 = /^([a-zA-Z]+)*$/;     // nested quantifiers
```

- Use `re2` or `safe-regex` to detect vulnerable patterns.
- Always limit input length before applying regex.

## Input Validation with express-validator

```js
// DO — validate and sanitize all inputs
import { body, param, validationResult } from 'express-validator';

app.post('/users',
  body('email').isEmail().normalizeEmail(),
  body('name').trim().isLength({ min: 1, max: 255 }).escape(),
  body('age').optional().isInt({ min: 0, max: 150 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // proceed with validated data
  }
);

// DON'T — trust req.body directly
app.post('/users', async (req, res) => {
  const user = await User.create(req.body);  // no validation, mass assignment
});
```

## Async Error Handling

```js
// DO — catch async errors (Express 5 handles this automatically)
// For Express 4, wrap async handlers:
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
}));

// DO — global error handler that does not leak internals
app.use((err, req, res, next) => {
  console.error(err);  // log full error server-side
  res.status(500).json({ error: 'Internal server error', requestId: req.id });
});

// DON'T — unhandled rejections crash the process or leak stack traces
app.get('/users/:id', async (req, res) => {
  const user = await User.findByPk(req.params.id);  // unhandled rejection on DB error
  res.json(user);
});
```

## Common Footguns

- **No helmet**: missing security headers on every response. Add `helmet()` as the first middleware.
- **`cors({ origin: true })`**: reflects any origin, effectively a wildcard that works with credentials.
- **Prototype pollution via `_.merge`**: deep merge of user input can overwrite `Object.prototype`. Sanitize keys.
- **ReDoS**: nested quantifiers in regex (`(a+)+`) cause exponential backtracking. Limit input length and use safe patterns.
- **Missing async error handling**: Express 4 does not catch promise rejections. Unhandled errors crash the process or hang.
- **`eval()` / `new Function()` with user input**: remote code execution. Never dynamically evaluate user-provided strings.
- **`process.env` defaults with fallback secrets**: `const key = process.env.API_KEY || 'dev-key'` silently uses the fallback if env var is missing. Fail fast instead.
