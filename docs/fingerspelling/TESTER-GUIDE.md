# Local ASL webcam testing

This is an optional recognition study, not a communication aid. Every prediction is uncertain. No physical-device validation has yet been completed by this engineering sprint.

## Start a session

1. Open the PR #49 Vercel preview. Choose ASL, open the signing workspace and select **Fingerspelling**.
2. Expand **Optional webcam testing**. Read the privacy note and choose the local-testing checkbox. This records test metrics only in this tab; it does not upload images, landmarks, text or results.
3. Select your device, hand, lighting and speed. Use **Start camera** / **Start signing** and grant camera permission yourself. No microphone is needed.
4. Face the camera with light in front of you, a plain background and your entire signing hand/forearm visible. Keep the device steady. Start at a comfortable distance where fingers remain clear.

## Record positives and ordinary actions

5. Choose ANNA, QUINN, JAZZ or LILY. Press **Start test before signing**, fingerspell the complete prompt, then press **Finish test**. Include the real movement for J/Z and distinct repeated letters. Try three repetitions of each at your usual speed. Save mistakes and abstentions, not just successes.
6. Check **Raw prediction**. Enter what you actually fingerspelled if it differs from the prompt. Confirm that ground truth, select a problem type if appropriate, then **Save local result**. The editable candidate and composed draft are separate from this raw research result.
7. Choose No hands, Wave, Handwashing, Adjust clothing or Other signing. Perform only that action for about three seconds. Do not fingerspell during a negative trial. Confirm the action and save any rejection or unexpected text. Do not press Confirm text or Speak during these trials.
8. Repeat at a slower and faster comfortable speed. Try your other hand only if comfortable; record which hand you actually use. Repeat in dim/back lighting and from a modestly higher/lower camera angle. These are separate conditions, not attempts to find a flattering result.

## Check failures and lifecycle

9. In separate trials, briefly move your hand out of view mid-sequence, return it, and finish. Record tracking failures and the letters you actually completed. Also test Cancel, pause/restart camera, switch to Word Recognition and back, and hide/return to the tab.
10. Cancellation must leave no pending prediction that later modifies text. No candidate may automatically modify the draft or speak. Do not clear saved personal signs or word history for this study.

## Device checks

| Device | Browser and practical checks |
|---|---|
| Windows laptop | Start with current Chrome or Edge. Allow the site camera in both browser and Windows privacy settings. Close other camera apps if unavailable. Test on the built-in camera first. |
| MacBook | Test current Safari and Chrome separately. Grant browser camera access in macOS privacy settings. Keep the lid/camera angle fixed; reload after changing OS permissions. |
| Android | Test current Chrome, front camera and portrait first. Keep the screen awake. Repeat landscape as a separate condition; rotating during a recording should reject/restart the capture. |
| iPhone | Test current Safari, front camera and portrait first. Grant site camera access; keep the tab foregrounded. Repeat landscape separately. Record unsupported-browser or slow-tracking errors as technical failures. |

Browser layout emulation and recorded virtual cameras do not establish that any of these physical devices work. Report the actual browser/device used to the study organiser separately if you choose.

## Keep or clear results

11. Review local results. Cancels and technical failures are kept separate from recognition/negative-rejection counts. Text and corrected ground truth stay in tab memory; reloading, ending testing or closing the panel clears the local study.
12. If you choose to share metrics, select the separate download checkbox and **Download test metrics**. Review the JSON yourself before sending it through an agreed channel. The file omits text, video, landmarks, device identifiers and absolute timestamps; it contains prompt IDs, coarse self-reported conditions and relative timing/count metrics. It is not proof of independent signer identity.
13. No upload occurs automatically. The app does not produce raw training recordings. Independently reviewed, separately consented recordings and a private collection process are still needed before training an intent detector or fitting a defensible calibration policy.

Report each wrong, missing or unexpected recognition using the problem selector. If the page fails before a result exists, record the visible error and device/browser for the organiser; never interpret a technical failure as successful negative rejection.
