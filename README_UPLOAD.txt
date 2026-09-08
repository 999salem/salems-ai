S.A.L.E.M. GitHub Pages v1.3

Upload ALL files in this folder to the ROOT of your marcdoa/salems-ai repository.
This build includes a boot-screen failsafe and cache-busting so the app cannot stay trapped on the S.A.L.E.M. logo.

After GitHub finishes deploying, open https://marcdoa.github.io/salems-ai/ in Safari once, refresh it, then close/reopen the Home Screen app.
If an old installed PWA is still showing an old cached version, remove that Home Screen icon once and add the site again after visiting the fresh site in Safari.

Do not put OPENAI_API_KEY into GitHub. salem-worker.js belongs in Cloudflare Worker code, with the API key stored as a Cloudflare Secret.
