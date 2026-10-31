# ACLS Monitor Simulator

A web-based patient monitor for ACLS training. One device (laptop, TV, tablet) shows the
monitor; the instructor's phone controls the ECG rhythm and vital signs live. Nothing to
install: open the link on both devices and pair with a 6-digit code.

**Live app:** https://icalitulaci.github.io/ecg-acls-simulator/ (after GitHub Pages is enabled, see below)

> Training tool only. Not a medical device.

## How to use

1. **Monitor:** open the link on the screen the students will watch and tap **Monitor**.
   A 6-digit pairing code and a QR code appear.
2. **Controller:** on the instructor's phone, scan the QR code, or open the link, tap
   **Controller** and type the code.
3. Pick rhythms, change vitals or run a scenario. The monitor updates instantly.

Tips
- Tap the monitor once to enable sound (browsers block audio until you tap). On an iPhone or
  iPad, also turn off silent mode.
- Use the ⛶ button for full screen. The screen is kept awake while the monitor is open.
- The monitor keeps its code if it is reloaded, and the controller can reconnect any time
  without resetting the scenario.
- A second screen can mirror the same session: on the pairing screen choose
  **Join an existing code**.

## Features (v1: rhythms and vitals)

**Rhythms (lead II):** normal sinus, sinus brady, sinus tach, SVT, A-fib, A-flutter (with the
conduction ratio derived from the rate), junctional, 1st-degree block, 2nd-degree type I
(Wenckebach), 2nd-degree type II (Mobitz II), 3rd-degree block (atria and ventricles at
independent rates), idioventricular, VT, torsades, coarse and fine VF, asystole and PEA.
PVCs (occasional, frequent, bigeminy, trigeminy) can be added to sinus, A-fib and 1st-degree
rhythms, with compensatory pauses.

**Vitals:** HR, SpO₂ with pleth waveform, NIBP (with a "Cycle NIBP" cuff measurement), EtCO₂
with capnography waveform, respiratory rate and temperature.

**For the instructor**
- A pulse toggle. Pulseless rhythms show no pleth and give no SpO₂ or BP reading, as on a
  real monitor (good for PEA and pulseless VT).
- Sensor toggles (leads, SpO₂ probe, cuff, capnography, temperature) to reveal values only
  when the students attach them.
- Gradual changes: vitals can trend over 10 s, 30 s, 1 min or 2 min.
- A **Live updates** switch. Turn it off to prepare several changes, then press
  **Send to monitor**.
- One-tap ACLS scenarios: stable, symptomatic brady, complete heart block, unstable SVT,
  A-fib with RVR, VT with pulse, pulseless VT, VF, torsades, asystole, PEA and ROSC.
- A live preview of the monitor on the phone.

**Monitor realism:** sweeping traces, a QRS beep whose pitch drops as SpO₂ falls, and
prioritised alarms (banner, flashing values, tones).

## Turning on the link (GitHub Pages)

1. On GitHub open **Settings → Pages**.
2. Under **Build and deployment** pick **Source: Deploy from a branch**.
3. Choose the branch with this code (for example `main` after merging) and the **/ (root)**
   folder, then **Save**.
4. After about a minute the app is live at `https://icalitulaci.github.io/ecg-acls-simulator/`.

## How pairing works

GitHub Pages can only host static files, so the two devices exchange messages through free
public MQTT relay servers over secure WebSockets (HiveMQ, EMQX and Mosquitto test brokers). The
pairing code is the channel name. The app connects to all three relays at once, so one being
down doesn't break the session. Two tabs in the same browser also pair directly, without
internet.

- Both devices need internet access, and the network must allow WebSocket connections on
  ports 8884, 8084 or 8081. Some strict school or hospital Wi-Fi networks block these. If so,
  use a phone hotspot.
- The relays are public and unauthenticated. Only simulated vitals are sent; never enter real
  patient data.
- To use your own broker, add `?relay=wss://your-broker:port/path` to the link on both devices.

## Project layout

```
index.html            single page; routes ?monitor and ?join=CODE
css/style.css
js/app.js             home screen + routing
js/monitor-page.js    pairing screen, sound, full screen, wake lock
js/host-page.js       controller UI
js/monitor-view.js    monitor renderer (canvas sweeps, numerics, alarms)
js/signal.js          ECG / pleth / capnography waveform synthesis
js/link.js            pairing transport (minimal MQTT-over-WebSocket client)
js/rhythms.js         rhythm catalogue
js/state.js           shared state, presets, validation
js/audio.js           QRS beep and alarm tones
vendor/qrcode.js      QR code generator (MIT, Kazuhiko Arase)
```

No build step. To run locally, serve the folder with any static server, e.g.
`python3 -m http.server`, and open http://localhost:8000.
