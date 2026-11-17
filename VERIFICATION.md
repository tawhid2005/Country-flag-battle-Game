# Verification — 17 November 2026

Executed in the available Node JavaScript runtime against the actual application code and bundled Matter.js. No real payments or remote database changes were made.

| Scenario | Center vortex hole | Outer ring escape |
|---|---|---|
| 40 countries, blitz (140 s) | 140.00 s; one winner | 140.00 s; one winner |
| 120 countries, blitz (140 s) | 140.00 s; one winner | 140.00 s; one winner |
| 40 countries, standard (300 s) | 300.00 s; one winner | 300.00 s; one winner |
| 120 countries, standard (300 s) | 300.00 s; one winner | 300.00 s; one winner |
| 40 countries, extended (540 s) | 540.00 s; one winner | 540.00 s; one winner |
| 40 countries, marathon (780 s) | 780.00 s; one winner | 780.00 s; one winner |
| 195 countries, blitz (140 s) | 140.00 s; 194 eliminated | 140.02 s; 194 eliminated |

The simulated clock advances at 60 physics steps per second. These are simulation results, not guarantees for a suspended or overloaded browser. The pacing director actively recovers stalled eliminations through the chosen hazard. The 7–15 second victory intermission is separate from the match duration.

Additional checks passed:

- Fresh/saved settings, 120-ball saved configuration, and storage-denied startup.
- Arena/caller canvas state preservation for both templates at three display scales and three zoom levels, plus live frames. This regression originally reproduced the off-center ball rendering error.
- Hole-mode marble containment across 600 steps and throughout full simulated matches.
- Password hashing, session tampering/expiry, customer/admin role separation, origin checking and persistent rate-limit rejection through a mocked database API.
- Mocked Polar and SSLCOMMERZ checkout initiation, server-side amount/currency/order/product verification, invalid signatures and stale webhook rejection, cross-account order isolation, duplicate notification handling and unverified callback rejection.
- Game-only login and activation; legacy `?admin=true` cleanup; customer return routing; forged client admin session rejection.
- Application, service worker and admin JavaScript syntax; `git diff --check`.

Not verified: browser screenshots/responsive visual QA, deployed Vercel routing, real Supabase SQL execution/locking, real merchant sandbox transactions, provider webhook delivery or live activation. Node CLI is not installed in the shell, so test functions were invoked through the available Node runtime; `npm test` is supplied for Node 22 environments.

Before accepting real payments, follow [SETUP.md](SETUP.md), provision the database, configure server secrets, deploy, run merchant sandbox success/failure/duplicate tests and verify a single entitlement extension from simultaneous real callbacks. Existing old-format activation keys/accounts need reviewed migration; they are not silently trusted or automatically copied.

## Payment and game-clarity follow-up

A read-only request to the live public health URL returned HTTP 200 **game HTML**, not the JSON API response. The live site was serving the older application rather than the new payment function at that path. No live deployment or merchant configuration has been changed.

The simplified checkout now uses manual Bangladesh WhatsApp requests and a separate email/password Polar flow. Mocked checks cover the official buy.polar.sh host, public www/non-www aliases, signed receipt recovery after cookie loss, tampered/expired/wrong-account receipts, HTML-instead-of-JSON errors, retry after transient verification failure and automatic game login after a verified payment. Address/city/postcode and misleading personal-transfer verification controls are removed.

Eliminations now use continuous guided paths, an aligned physical/visible gate, exit chevrons and lane, an OUT marker, and clipped vortex shrink animation. Sink/out animations continue through the victory screen. Both modes completed fresh 40/120/195-country blitz simulations in 140.00 seconds with one survivor. Direct motion checks verify bounded frame movement and completed post-victory animations; no screenshot/rendered-browser verification was performed.

YouTube reference located: [Marble Factory — Loop Route Elimination Ring](https://www.youtube.com/watch?v=DhX55rhWHM4). Search metadata was available; full video playback was unavailable. The motion implementation was verified against the game code and simulated trajectories, not claimed to be a copy of video frames.

## Post-exit stall regression

Reproduced the reported freeze by starting a guided transition during the pacing cooldown: the old code held a contender at its guide endpoint for more than 2.5 seconds. Completion now depends on crossing the hazard, not waiting for the timer. Ring contenders already through the gate keep an outward velocity and are never pulled back by the cooldown.

Fresh complete blitz rounds with 40, 120 and 195 contenders passed in both modes: 139.67–139.75 simulated seconds, with one winner. Ending up to a fraction of a second before 140 seconds reflects immediate hazard crossing rather than artificially holding an escaped contender. The cache version is now v9. These local simulation results supersede earlier exact-140-second descriptions for this revision.

For the post-exit fix, separate bounded checks also passed: 120-country standard rounds at 299.47 s (hole) and 299.72 s (ring); 40-country extended rounds at 539.69 s and 539.74 s; marathon rounds at 779.62 s and 779.72 s. One combined long simulation exceeded the tool runtime and was rerun as these smaller checks. The explicit cooldown regression confirms immediate removal, continuing outward motion and wheel resumption. Payment, account, client-access, checkout and startup checks passed in the available Node runtime.

## Admin login and password-manager follow-up

The live public health endpoint reported database=false and admin=false. No default administrator password is embedded in this build: hosting environment configuration and the database are required. Added setting-name-only diagnostics, canonical admin-origin navigation and password-manager-compatible form names/autocomplete. A supporting browser is asked to store credentials only after successful authentication; browser settings and consent remain authoritative. Mocked admin UI and server checks passed; actual Google Password Manager saving and live administrator access remain unverified until hosting setup is completed.
