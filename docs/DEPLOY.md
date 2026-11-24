# Firebase release

The GameShow build uses Hosting target **gameshow** and its own local **.firebaserc** mapping. The deploy script rejects both the original SignRelay project ID and its site ID. Use a separate Firebase project for GameShow. The kiosk at **127.0.0.1:8787** works independently of this release.

From the GameShow source folder, install Firebase CLI if needed and authenticate using an account authorized on a separate project. In PowerShell, substitute your actual independent project ID. The site-create command requires a unique site ID. If Firebase reports that **signrelay-gameshow** is already reserved, set `$site` to **signrelay-gameshow-uae** and retry the site commands. Choose another unique GameShow identifier if that one is also reserved.

```powershell
npm install -g firebase-tools
firebase login
firebase projects:list
$project = 'YOUR-INDEPENDENT-GAMESHOW-PROJECT-ID'
$site = 'signrelay-gameshow'
# Run once if you do not already have an independent Firebase project.
firebase projects:create $project --display-name 'SignRelay GameShow'
firebase hosting:sites:list --project $project
# Omit site creation if the chosen site is already listed for this project.
firebase hosting:sites:create $site --project $project
firebase target:apply hosting gameshow $site --project $project
pnpm install --frozen-lockfile
pnpm assets
pnpm build
pnpm test
pnpm test:browser
pnpm run deploy $project $site
```

If the site already exists and belongs to the authorized project, omit the create command. Inspect the **gameshow** mapping in **.firebaserc** before publishing. The script checks the destination against that exact project and site, checks the complete production build, deploys only **hosting:gameshow**, and compares the served release manifest to the local one.

After deployment, use a fresh regular Chrome profile to open the new URL. Wait for **Offline Ready**, permit the camera, and test a complete game. Disconnect networking and reload. Verify that lesson playback, model loading, registration and camera still work. If operating the show locally and using the hosted site for visibility, expect separate browser storage at each address.

At the readiness check, Firebase CLI reported no signed-in account and the preferred site returned HTTP 404. A site’s availability is established by the authenticated create or list command. [Firebase CLI](https://firebase.google.com/docs/cli) · [Hosting deploy targets](https://firebase.google.com/docs/hosting/multisites)

