# Department LAMP deployment — CodeCrafters

The department publishes the uploaded ZIP through Moodle. There is no SSH or
SCP step. The server serves the built static files; Node, npm and Vite run only
on your development machine.

Group name supplied: **CodeCrafters**. The packaging command creates
[`submission/CodeCrafters.zip`](./submission/CodeCrafters.zip). Follow any further
filename requirements shown in the actual Moodle deployment activity.

## 1. Produce the archive

In PowerShell, from the repository:

```powershell
cd C:\CGV-Game-development
npm run package
```

This builds the current game into `dist/` and refreshes `CodeCrafters.zip`.
After any game change, run it again before uploading. If setting up a fresh
checkout, run `npm ci` first to install the build dependencies locally.

`vite.config.js` already uses `base: './'`. The production JavaScript bundles
Three.js and cannon-es; markers do not need to install them. The archive
contains the static files and runtime assets, not `src/`, `node_modules/` or
the surrounding `dist/` folder:

```text
CodeCrafters.zip
├── index.html
├── favicon.svg
├── assets/
│   ├── index-<hash>.js
│   ├── index-<hash>.css
│   └── textures/menu-bg.png
├── models/
│   └── *.glb
└── licenses/
    └── *.txt
```

Do not open `index.html` by double-clicking it, or upload the source repository
instead of this archive.

## 2. Test the production build under a group folder

```powershell
npm run preview:deployment
```

Leave that terminal running, then open Chrome at:

**http://127.0.0.1:4174/group-game/**

If a preview is already running there, use that URL. Press Ctrl+C in its
terminal to stop a preview you started. If you need another port:

```powershell
$env:DEPLOYMENT_PREVIEW_PORT = '4175'
npm run preview:deployment
```

Then use port 4175 in the URL. The local `/group-game/` name is a test prefix,
not a claim about the department's eventual group-folder name.

This preview serves only `dist/`, without development transforms or a fallback
for missing files. It deliberately rejects root-level asset URLs and incorrect
filename case, even on Windows. Both are common Linux subdirectory problems.
For example, `/group-game/models/locker.glb` should load, while
`/models/locker.glb` and `/group-game/models/Locker.glb` should return 404.

Complete a human playthrough of this build before upload:

- Level 1: training, relay power restoration, breach and control-room exit.
- Level 2: rescue both scientists, isolate pressure, download archive records
  through 100%, then reach core access.
- Level 3: survive the pre-power threat, activate both generators, defeat the
  three-node boss and follow the extended maintenance escape to the surface.
- Check first/third-person views, shooting, map, audio, pause/resume, failure
  and current-level retry. Watch for collision or animation problems and lag.
- Open Chrome DevTools (F12). Check Console for errors and Network for missing
  files. All game asset requests should stay beneath the group-folder prefix.

Automated checks cover parts of this process; they do not replace the full
human playthrough or a performance check on the intended Chrome/Ubuntu hardware.

## 3. Upload through Moodle

1. Open the course's **game deployment/archive submission** activity.
2. Check its filename convention and upload limit. Use `CodeCrafters.zip`
   unless the activity specifies additional naming requirements.
3. Choose **Add submission** or **Edit submission**, as offered by that activity.
4. Upload `C:\CGV-Game-development\submission\CodeCrafters.zip`.
5. Save the submission. If the activity requires a separate final-submit
   button, complete that step too and check the displayed submission status.
6. Use the published game link supplied by the course/deployment activity when
   available. The exact server address and group-folder name are not recorded
   in this repository, so do not guess the final URL.

Uploading the archive to Moodle is the deployment mechanism. You do not start
a server process, install packages or run build commands on the department server.

## 4. Verify the published game

Open the published HTTPS URL in Chrome and play all three levels again. Check
models, textures, audio, menus, retry and final victory. Ask another group member
to open the link on a different machine; markers must reach it without local
setup. Record the exact URL and date once verified.

After replacing a deployment, use Ctrl+Shift+R to reload without stale cached
files. Check DevTools again:

| Symptom | What to check |
|---|---|
| Blank page or missing JavaScript | Upload the built ZIP; ensure `index.html` is at archive root and asset URLs remain relative. |
| Missing model/texture on the department server | Compare requested filename and on-disk case exactly; check that the ZIP contains the file. |
| Requests go to `/assets/` or `/models/` outside the group folder | Remove the leading slash from runtime asset paths and rebuild/reupload. |
| Vite WebSocket errors or references to port 5173 | Use the production preview or published URL; the uploaded production game does not use the Vite dev server. |
| No audio before interacting | Click Start/Begin; browser audio needs user interaction. Check mute and volume options. |
| HTTPS mixed-content error | An external resource uses HTTP. Runtime resources must be included locally or use HTTPS. |

The local preview does not verify Moodle publication or the department's
server configuration. The published URL check remains a separate final step.

## Local preparation check — 15 October 2026

- `npm run package` succeeded. `submission/CodeCrafters.zip` is 4,098,848 bytes
  (about 4.1 MB), contains 14 files and has `index.html` at archive root.
- Every archive file was hash-compared with its corresponding built file;
  no source folders or `node_modules` are included.
- All 14 built files loaded beneath `/group-game/`; incorrect filename case,
  root-level model paths and missing files returned 404 as intended.
- Automated production Chrome checks passed loading, credits/license links,
  Level 1 start/briefing, shooting/view/map input, pause and restart. Runtime
  requests stayed within the group prefix with no failed requests or errors.
  The development debug handle was absent from the production game.
- `npm test`: 66 tests passed. Build notices remain for bundle size and the
  menu-image reference; the actual menu image loaded successfully in preview.
- Full human playthrough, target-hardware performance, Moodle upload and the
  published URL remain pending. These checks do not claim a full playthrough.
