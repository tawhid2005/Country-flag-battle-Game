# Admin login চালু করার নিয়ম

কোডে কোনো default admin password নেই। আগের public/hardcoded password এখন গ্রহণ করা হয় না। Live health check-এ `database: false` ও `admin: false` পাওয়া গেছে—অর্থাৎ hosting configuration অসম্পূর্ণ। এতে password বদলালেই সমস্যাটি মিটবে না।

1. Vercel project → **Settings → Environment Variables** খুলুন। Production environment-এর জন্য নিচের নামগুলো সেট করুন।

| নাম | কী দিতে হবে |
|---|---|
| `APP_ORIGIN` | `https://www.countryflagbattle.xyz` |
| `ADMIN_USERNAME` | আগের ID রাখতে চাইলে `tawhidh2005` দিন |
| `ADMIN_PASSWORD_HASH` | নতুন শক্তিশালী password থেকে তৈরি `scrypt$…` hash; এখানে সরাসরি password দেওয়া যাবে না |
| `SESSION_SECRET` | আলাদাভাবে তৈরি random secret; কমপক্ষে 32 bytes ব্যবহার করুন |
| `SUPABASE_URL` | আপনার Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase-এর server-only service-role key |

2. Password hash তৈরি করার command [SETUP.md](SETUP.md)-এর **Hosting environment** অংশে আছে। সেখানে password লুকিয়ে input দেওয়ার ব্যবস্থা আছে। এই কাজে Node.js লাগে। কোনো password বা secret chat, GitHub, screenshot বা public HTML-এ দেবেন না।
3. Supabase project-এ [database/schema.sql](database/schema.sql) চালিয়ে tables/functions তৈরি করুন। তারপর Vercel deployment **Redeploy** করুন। নতুন environment variables কেবল redeploy-এর পর কার্যকর হবে।
4. `https://www.countryflagbattle.xyz/admin` খুলুন। Environment-এ দেওয়া ID এবং hash তৈরিতে ব্যবহৃত **মূল password** দিয়ে login করুন; hash দিয়ে login করবেন না।

## Google Password Manager

Login form এখন browser autofill ও password manager-এর উপযোগী। সফল login-এর পর সমর্থিত Chrome-এ password manager-এ save করার অনুরোধ করা হয়। এটি browser-এর নিজস্ব setting ও confirmation অনুযায়ী কাজ করে; ব্যর্থ login-এর credentials save করার অনুরোধ করা হয় না।

Chrome → **Settings → Autofill and passwords → Google Password Manager → Settings → Offer to save passwords and passkeys** চালু রাখুন। সফল login-এর পরে Save/Update prompt এলে সেটি গ্রহণ করুন। সাইট নিজে Chrome-এর setting বদলাতে বা save নিশ্চিত করতে পারে না।

Reference: [Google-এর password saving নির্দেশনা](https://support.google.com/chrome/answer/95606?hl=en)।
