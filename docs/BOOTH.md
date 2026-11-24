# Booth operations

## Prepare the booth laptop

1. Install Node.js 22+ and desktop Chrome before going to the venue. Extract the offline ZIP to a local folder. Open a terminal inside it and run **node scripts/serve.mjs 8787**. Keep the terminal open.
2. In a regular Chrome profile, open **http://127.0.0.1:8787**. Keep this URL and profile for the entire exhibition. Score data is tied to the browser origin. Avoid guest or incognito windows, storage cleanup and profile changes during the event.
3. Open **Host controls** using the gear icon or **Alt+H**. Open **Readiness and diagnostics**. Wait for **Model Ready** and **Offline Ready**, then choose **Request durable storage**. A refusal from Chrome does not prevent normal IndexedDB operation. Keep an external JSON backup regardless.
4. Register a rehearsal nickname, spin and choose **Ready**. Allow the camera when Chrome prompts. Confirm both hands and the upper body are visible, and check the preview under actual booth lighting. Try the external monitor and fullscreen.
5. Turn off Wi-Fi and unplug Ethernet. Reload the same URL and repeat a challenge and lesson playback. For a service-worker-only check, stop the local server after Offline Ready, reload, and test lesson playback and camera again. Restart the local server before the show to have a second local copy of every asset.
6. Remove rehearsal players, or use **Host controls → Session and backups → Reset session** and confirm it.

## Run the game

1. Select **Join the game** or **Switch player**. Add a nickname or search by name or player ID. Share the numeric ID with participants who use the same nickname.
2. Spin the wheel. Give the player time to watch and replay the short sign demonstration. **Ready** starts the 20-second round after the camera and models are ready. Participants can retry freely before the clock expires.
3. Use **Alt+H** or the gear to pause or resume. **Confirm correct** records an observed correct sign as a manual award. **Restart round** restarts the same sign with 20 seconds. **Skip round** returns it to the pool and keeps the round available. A camera failure pauses the attempt and triggers one automatic recovery.
4. If camera recognition is unusable, use **Host judging only** and show the participant the same local lesson. A host who can assess the sign can award 10 points with **Confirm correct** during the round. Keep automatic and manual trial counts distinct when evaluating the verifier.
5. Use **Full leaderboard** to show all scores and the fullscreen button in that view for audience display. Press Escape and close the view to return to the game. The gear also offers attract mode. Returning participants can reclaim unfinished rounds by selecting their original player ID.
6. Export JSON backups regularly to a second location. CSV is for viewing scores. Restore from JSON only when replacing the current session is intentional. Keep a separate copy of the most recent backup before any restore or reset.

Use one operator tab. A second tab can follow the leaderboard and refresh from IndexedDB. Close the original operator tab and reload the secondary tab to transfer controls. If Chrome loses a live tab unexpectedly, reopen the same URL and profile. The unfinished sign remains selected and can be restarted.

## Physical acceptance check on 26 November

- Ask a fluent ASL signer to review all ten clips, their short cues, and the variation accepted by the booth host. Bring the camera just above eye level and frame both hands from the upper chest to past the forehead.
- Recruit several consenting beginners and at least one habitual left-handed signer. Start each timed trial from rest. For each target record the number of accepted clean and imperfect attempts, wrong-target/ordinary-motion accepts, timeouts, and time from visible sign onset to score. Try natural slow and fast signing and lighting extremes expected at the booth.
- Include hands-down, held hand, reaching and idle movement trials. Unplug and reconnect the external camera. Verify denied permission and the fallback host flow.
- Let the intended laptop run for the expected operating window with periodic sign trials and JSON exports. Verify that the camera still starts, signs still respond, and Chrome does not accumulate workers or memory across repeated rounds.

The recorded replay figures describe supported video files. The physical checks establish how the booth setup and its visitors actually perform.

