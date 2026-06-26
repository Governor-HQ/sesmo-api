// DEV ONLY — mint a JWT to exercise protected endpoints before login is built.
// Usage:  JWT_SECRET=your-secret node scripts/make-test-token.mjs <user_uuid>
// Then in the browser console on the wallet page (live mode):
//   localStorage.setItem('sesmo_user_token', '<paste token>')
import jwt from "jsonwebtoken";

const userId = process.argv[2];
if (!userId) { console.error("Usage: node scripts/make-test-token.mjs <user_uuid>"); process.exit(1); }
if (!process.env.JWT_SECRET) { console.error("Set JWT_SECRET in the environment first"); process.exit(1); }

console.log(jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: "7d" }));
