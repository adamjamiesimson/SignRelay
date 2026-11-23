# Physical acceptance checklist for Adam and Ankush

Run on the actual booth laptop and camera, and on a physical iPhone with Safari and Android phone with Chrome when available. Record candidate SHA, build profile, worker hash, browser and OS versions, device and camera, light and background, and whether the network is disconnected.

- Start from a fresh browser profile. Deny camera access, confirm an intelligible recovery message, grant permission, and start again. Confirm the physical camera indicator clears after Stop, page navigation, language change, and closing the browser.
- Test front and rear cameras where supported. Check both signing hands against the mirrored preview and overlay. Verify framing keeps the head, hands and upper body visible through the whole sign.
- Conduct fresh, consented isolated-sign trials for HELLO, THANK YOU, PLEASE, YES and NO, then a small independently reviewed subset of the broader vocabulary. SORRY is absent from the frozen V3.1 vocabulary and must be treated as unsupported. Use a fluent ASL reviewer blind to predictions. Include left-handed signers, legitimate variants and normal signing speed. Record correct accepted, incorrect accepted, abstained or runtime error for each attempt, including the suggested word, whether the reviewer added it, and the timestamp. Check that unreviewed model suggestions never enter text or speech.
- Include idle posture, repositioning, common non-sign gestures and unsupported signs. Count every false acceptance. Leave a natural pause between trials and include deliberate same-sign repeats. Record any duplicates and delayed emissions after stopping.
- Run at least ten minutes. Track the frame-rate and hand-observation readouts with `?perf`, record slowdowns, browser errors, and restart behavior. Repeat the demo after backgrounding the browser, switching cameras, and reloading.
- Read the transcript back, edit an entry, remove a word, save and clear, reload, and confirm persistence and session isolation. Test manual speech, auto-speech, Stop speech, volume and rate. Check the selected operating-system voice with networking disconnected.
- Power-cycle the offline host or restart its browser and server with Wi-Fi disconnected. Cold start, start the physical camera, perform a short sequence, and check that the transcript and local voice work as expected.
- Use independent evidence per sign to decide which signs can be demonstrated live. Record abstentions openly. Keep private test footage off public repositories, attachments and logs.

Physical gates are pending until the observations and denominators are recorded. Follow [the original review guide](../gitex/independent-review-guide.md) and [the booth runbook](OFFLINE_DEMO.md).
