# Firebase release

The GameShow build uses Hosting target **gameshow** and its own local **.firebaserc** mapping. The existing SignRelay site at **signrelay.web.app** is prohibited by the deployment script. The kiosk at **127.0.0.1:8787** works independently of this release.

From the GameShow source folder, install Firebase CLI if needed and authenticate using an account authorized on the destination project. Replace PROJECT_ID with the chosen Firebase project. Use a different SITE_ID throughout if **signrelay-gameshow** is unavailable.

```sh
npm install -g firebase-tools
firebase login
firebase hosting:sites:list --project PROJECT_ID
firebase hosting:sites:create signrelay-gameshow --project PROJECT_ID
firebase target:apply hosting gameshow signrelay-gameshow --project PROJECT_ID
pnpm install --frozen-lockfile
pnpm assets
pnpm build
pnpm test
pnpm test:browser
pnpm run deploy PROJECT_ID signrelay-gameshow
```

If the site already exists and belongs to the authorized project, omit the create command. Inspect the **gameshow** mapping in **.firebaserc** before publishing. The script checks the destination against that exact project and site, checks the complete production build, deploys only **hosting:gameshow**, and compares the served release manifest to the local one.

After deployment, use a fresh regular Chrome profile to open the new URL. Wait for **Offline Ready**, permit the camera, and test a complete game. Disconnect networking and reload. Verify that lesson playback, model loading, registration and camera still work. If operating the show locally and using the hosted site for visibility, expect separate browser storage at each address.

