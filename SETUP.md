# Server setup and release checklist

Admin login troubleshooting in Bengali: [ADMIN_SETUP_BN.md](ADMIN_SETUP_BN.md).

The local `index.html` remains a game preview. Account login, `/admin`, paid plans and gateway callbacks require the deployed HTTPS site and the database below. No real payment has been made or tested by this code change.

## 1. Database

Create a Supabase project. Run [database/schema.sql](database/schema.sql) in its SQL editor on a new project. This creates accounts, orders, entitlements, events and persistent rate limits. All tables use row level security with **no browser access policies**. Only the server service role can access them. Accounts from the previous browser-local/shared JSON database do **not** migrate automatically; reissue verified customers through the admin workspace.

Orders are fulfilled by `cfb_complete_order` in a database transaction. Order/account locks serialize simultaneous notifications and renewals. Replaying the same payment does not add more days. A new paid order extends an existing active pass; a revoked/expired pass starts from verification time. Lifetime is represented as 100 years. Take database backups and periodically purge old `cfb_limits` rows.

## 2. Hosting environment

Use the existing Vercel project with Node 22, Framework Preset **Other**, root directory this repository, no build command, and no custom output directory. The `api/service.js` function is routed through `vercel.json`. This uses no npm dependencies.

Copy variable **names** from [.env.example](.env.example) into Vercel's server environment settings. Do not put real values in Git, HTML, JavaScript served to the browser, chat, screenshots, or URLs. `APP_ORIGIN` must be the exact final HTTPS origin, e.g. `https://www.countryflagbattle.xyz`. Redirect the other domain to that canonical origin. Cookies are host-only and webhooks must point directly to the final domain.

Set `SUPABASE_URL` to the HTTPS project URL from Supabase's Connect dialog and `SUPABASE_SECRET_KEY` to a server-only `sb_secret_...` key from Settings → API Keys. The backend sends new secret keys only in the `apikey` header, because they are not JWTs. Existing `SUPABASE_SERVICE_ROLE_KEY` remains a legacy fallback; a nonempty `SUPABASE_SECRET_KEY` takes precedence. Publishable keys cannot configure this backend. Never copy an exposed key into deployment settings: revoke it and generate a replacement directly in Supabase. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

The database is still required for verified Polar purchases and persistent manual grants. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and a random `SESSION_SECRET` of at least 32 bytes. Generate the password hash locally with Node using the exported `hashPassword` helper; enter the password through hidden stdin, not command arguments. One option in PowerShell with Node installed:

```powershell
$secureAdminPassword = Read-Host 'New administrator password' -AsSecureString
$credentialForHash = New-Object System.Management.Automation.PSCredential('admin', $secureAdminPassword)
$credentialForHash.GetNetworkCredential().Password | node scripts/hash-admin-password.mjs
```

Copy only the resulting `scrypt$...` hash to `ADMIN_PASSWORD_HASH`. The helper accepts passwords of 12–128 characters. Use a strong unique password. Generate `SESSION_SECRET` with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` and copy it directly to the server environment. Rotating this secret invalidates sessions and all activation links.

If `.admin-credentials.local.json` has been prepared locally, copy its named values into the corresponding Vercel environment settings. This optional private file is ignored by Git, is not loaded by the application, and is never deployed through a GitHub push. Keep the `scrypt$...` value unchanged when copying it. Supabase settings are still required, and changes take effect only after redeploying. A successful local hash check does not configure or verify the live login.

**Rotate/revoke the Polar and Paymently secrets exposed by older releases**, even if the old source is deleted. The old unauthenticated shared JSON database is disconnected and must not hold current customer credentials. Secure/remove its old contents separately after preserving any necessary customer records.

## 3. Polar

Start with `POLAR_ENV=sandbox`, a sandbox access token, sandbox webhook secret and sandbox product IDs. Configure `POLAR_PRODUCTS` as JSON mapping every plan to its **one-time** product UUID. Match the prices in `server/security.js`: $3.99 / $5.99 / $9.99 / $15.99 / $19.99 / $25.99. Recurring products, trials, discounts and mismatched prices are not supported by this fixed-duration pass implementation and will not grant access.

Register a **raw JSON** webhook for `order.paid` and `order.refunded`:

```
https://YOUR_FINAL_DOMAIN/api/webhooks/polar
```

Checkout can open with the server access token and product mapping even while webhook configuration is pending: the browser return still verifies independently through the authenticated provider API. Configure webhooks before production so purchases also activate when the customer closes the tab. Both current Standard Webhooks and Polar's documented legacy HMAC secret schemes are supported. Signatures and timestamp tolerance are checked; payment details are then fetched independently from Polar's authenticated API. Matching order, checkout, product, currency, net amount and paid/refund state are required. Never activate based on a browser success URL. Refunds hold the account for admin review; this may affect other active purchases on that account.

Use sandbox cards to verify successful checkout, declined/canceled payment, webhook redelivery, delayed notification, mismatched amount, and refund. Then switch **all** Polar credentials/product IDs to production and set `POLAR_ENV=live`.

## 4. Bangladesh payments — manual for now

The public checkout uses WhatsApp for Bangladesh payments. There are no billing-address, city, postcode or automatic TrxID verification fields. A buyer can request payment instructions or send a review request containing the plan, amount, sender number, transaction ID and optional account identifier. Passwords are never included in these messages. WhatsApp opens a prepared draft; the buyer sends it.

After independently verifying the transfer, create/reuse the account in the admin workspace, grant its plan and share its activation link. Do not label an unverified personal Send Money transaction as paid. SSLCOMMERZ remains an optional backend adapter, but it is not offered by the current public checkout. Its environment values are not needed for manual Bangladesh payments.

## 5. Admin and customers

Open `/admin` manually. There is no admin link in the public game's account or checkout UI. The dashboard stays hidden until a server-authenticated admin session succeeds; every admin API checks that role independently. A customer cookie or localStorage edit cannot authorize it. Admin sessions expire after one hour; sign-out clears the cookie. Monitoring is paginated: counters/revenue describe the loaded page, not lifetime totals. USD and BDT are separate; manual grants are excluded from revenue.

From Player access, create/reissue an account, then grant or extend a plan **after verifying the transfer**. Orders show independently verified status and offer server re-verification and activation-link copying. New activation links use `/#activate=CFB2...` and always open the public game. Treat them as bearer credentials: do not post publicly. Expired/revoked passes cannot activate. Old `CFB-...` keys are no longer trusted because their signing salt was public; reissue them after review.

Polar checkout asks only for email and a game password, with an optional existing username; email becomes the login ID by default. Checkout saves the account before redirecting to Polar and stores an order reference locally plus a short-lived payment receipt in session storage. The signed receipt also returns in a URL fragment (not a request query), allowing the server to restore login after a www/non-www redirect or cookie loss. It grants no access until that order is independently confirmed paid. On return, the game checks the server repeatedly for up to 90 seconds. Webhooks can fulfill while the customer closes the browser; logging in later checks the database. If verification is still delayed, the customer sees a WhatsApp link containing an order reference and error, **not a password or key**. Clicking opens a draft; the customer sends it. Nothing automatically messages the admin.

## Verification limits

Run `npm test` with Node 22 installed. Tests exercise both arenas with real Matter.js, matrix save/restore across screen scales, 40/120-ball full rounds at 140/300 seconds (additional simulated checks cover 40-ball rounds at 540/780 seconds and 195-ball rounds at 140 seconds), account/admin isolation and mocked payment APIs. The mocked fulfilment test is not a live PostgreSQL transaction or merchant sandbox test. Run two concurrent real callbacks against the provisioned sandbox database and check one entitlement extension before launch.

Timing uses wall-clock seconds. Game speed changes physics, not the countdown. The pacing director guides stalled balls through the correct hazard to meet the deadline; this is an autonomous paced simulation, not purely unassisted physics. Switching arena restarts the round. The pacing timer schedules entry into a hazard; crossing it completes elimination immediately. A round can finish a fraction of a second before the countdown deadline rather than holding a visibly escaped marble in place. A heavily throttled or suspended browser can only finish when execution resumes; no web page can guarantee real-time behavior while the OS suspends it. Victory intermission adds a separate random 7–15 seconds before the next round.

No remote database, gateway settings, secrets, deployment or real customer data have been changed by preparing these files. Production activation is **not ready** until the above configuration and sandbox checks succeed.

References: [Polar webhook verification and retry policy](https://polar.sh/docs/integrate/webhooks/delivery), [Polar order API](https://polar.sh/docs/api-reference/orders/get), [SSLCOMMERZ server validation/IPN](https://developer.sslcommerz.com/doc/v4/), [Supabase row level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
