# Booth operations

## Prepare the booth laptop

1. Install Node.js 22+ and desktop Chrome before going to the venue. Extract the offline ZIP to a local folder. Open a terminal inside it and run **node scripts/serve.mjs 8787**. Keep the terminal open.
2. In a regular Chrome profile, open **http://127.0.0.1:8787**. Keep this URL and profile for the entire exhibition. Score data is tied to the browser origin. Avoid guest or incognito windows, storage cleanup and profile changes during the event.
3. Open **Host controls** using the gear icon or **Alt+H**. Open **Readiness and diagnostics**. Wait for **Model Ready** and **Offline Ready**, then choose **Request durable storage**. A refusal from Chrome does not prevent normal IndexedDB operation. Keep an external JSON backup regardless.
4. Register a rehearsal nickname, spin and choose **Ready**. Allow the camera when Chrome prompts. Confirm both hands and the upper body are visible, and check the preview under actual booth lighting. Try the external monitor and fullscreen.
5. Turn off Wi-Fi and unplug Ethernet. Reload the same URL and repeat a challenge and lesson playback. For a service-worker-only check, stop the local server after Offline Ready, reload, and test lesson playback and camera again. Restart the local server before the show to have a second local copy of every asset.
6. Remove rehearsal players, or use **Host controls → Session and backups → Reset session** and confirm it.

When replacing an earlier kiosk, export a JSON backup first. Stop the old server, start the new package on port 8787, and open the same address in the same Chrome profile with access to the local server. If Diagnostics shows the earlier build, reload once, let the update download, close every GameShow tab, and wait a few seconds before reopening the address. Check for build **f7f9531a61d13c30** next to **Offline Ready**. Leave browser site data intact so scores remain available.

## Run the game

1. Select **Join the game** or **Switch player**. Add a nickname or search by name or player ID. Share the numeric ID with participants who use the same nickname.
2. Spin the wheel. Give the player time to watch and replay the short sign demonstration. **Ready** starts the 20-second round after the camera and models are ready. Participants can retry freely before the clock expires.
3. Use **Alt+H** or the gear to pause or resume. **Confirm correct** records an observed correct sign as a manual award. **Restart round** restarts the same sign with 20 seconds. **Skip round** returns it to the pool and keeps the round available. A camera failure pauses the attempt and triggers one automatic recovery.
4. If camera recognition is unusable, use **Host judging only** and show the participant the same local lesson. A host who can assess the sign can award 10 points with **Confirm correct** during the round. Keep automatic and manual trial counts distinct when evaluating the verifier.
5. Use **Full leaderboard** to show all scores and the fullscreen button in that view for audience display. Press Escape and close the view to return to the game. The gear also offers attract mode. Returning participants can reclaim unfinished rounds by selecting their original player ID.
6. Export JSON backups regularly to a second location. CSV is for viewing scores. Restore from JSON only when replacing the current session is intentional. Keep a separate copy of the most recent backup before any restore or reset.

Use one operator tab. A second tab can follow the leaderboard and refresh from IndexedDB. Close the original operator tab and reload the secondary tab to transfer controls. If Chrome loses a live tab unexpectedly, reopen the same URL and profile. The unfinished sign remains selected and can be restarted.

## 20-minute live-webcam rehearsal

1. **Set up, 3 minutes.** One person hosts while the other signs. Use the exhibition laptop, camera, external display and booth lighting. Open the offline kiosk and wait for both readiness indicators. Keep **Relaxed 0.60** and frame the face, upper chest and both hands. In the host diagnostics, check the analyzed frame rate while someone signs. Aim for at least 8 analyzed frames per second and close other heavy apps if it stays lower.
2. **Play both roles, 8 minutes.** Create two rehearsal players with the same nickname. Take turns through five signs each, then swap host duties. Let each player watch the local clip before starting. Attempt a slow but natural version, an imperfect version, and a relaxed right- or left-handed version. Ask a fluent signer to check all ten demonstrations and their notes, including signs the wheel did not draw.
3. **Check false awards and fallback, 4 minutes.** During timed rounds, try a different sign, idle hands and a normal reach. Confirm the score stays unchanged. Pause, switch to the other ID, and return to confirm the remaining time. Disconnect and reconnect the camera. Verify that the round can resume. Have the host award a genuinely correct missed sign once and use **Skip round** on a deliberately interrupted attempt.
4. **Test offline and backups, 5 minutes.** Export JSON and CSV. Disable the laptop’s network and reload the exact kiosk URL. Check lesson playback, the live camera, score persistence, another completed round, and fullscreen. Restore the JSON only in this rehearsal session and verify the two IDs and scores. Re-enable the network afterward if needed and remove the rehearsal players before visitors arrive.

For each live trial, note the sign, approximate analyzed FPS, automatic/manual/timeout result, and any false award or camera problem. Use this log to set the host fallback before opening. For longer validation, leave this setup running across the planned exhibition window with periodic rounds and JSON exports. The automated camera tests used prerecorded input.

