// one-shot tenki VM run: compile the android half of appiary-game-services
// on a clean linux vm, mirroring the workflow order exactly.
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

const VM_SCRIPT = `set -u
S() { if command -v sudo >/dev/null 2>&1; then sudo -n "$@"; else "$@"; fi; }
log() { echo "== $*"; }
export DEBIAN_FRONTEND=noninteractive
log "host info: $(uname -a), user $(whoami)"
log "installing jdk + tools"
S apt-get update -qq 2>&1 | tail -1
S apt-get install -y -qq openjdk-21-jdk-headless unzip git curl 2>&1 | tail -1 || S apt-get install -y -qq openjdk-17-jdk-headless unzip git curl 2>&1 | tail -1
java -version 2>&1 | head -1
log "node check"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | S bash - >/dev/null 2>&1
  S apt-get install -y -qq nodejs >/dev/null 2>&1
fi
node --version || echo "NO NODE"
log "android sdk"
mkdir -p "$HOME/android-sdk/cmdline-tools"
cd "$HOME/android-sdk"
curl -fsSL -o clt.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q clt.zip -d cmdline-tools
mv cmdline-tools/cmdline-tools cmdline-tools/latest
export ANDROID_HOME="$HOME/android-sdk"
yes | cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null 2>&1
cmdline-tools/latest/bin/sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools" >/dev/null 2>&1
ls "$HOME/android-sdk/platforms" && log "sdk ok"
log "cloning appiary"
cd "$HOME"
rm -rf appiary
git clone -q "https://x-access-token:\${GH}@github.com/tinkerquest/appiary.git" appiary
cd appiary/template
log "config with gameServices + push + camera"
cat > capacitor.config.json <<'CFG'
{
  "appId": "com.demo.game",
  "appName": "appiary compile test",
  "version": "0.4.0",
  "permissions": ["gameServices", "push", "camera", "widgets"],
  "channel": { "name": "play" }
}
CFG
log "apply-runtime pre"
node scripts/apply-runtime.js pre android || { echo "APPiaryFAIL pre"; exit 1; }
log "npm install"
npm install --no-audit --no-fund 2>&1 | tail -15
[ -d node_modules/@capacitor/android ] || { echo "APPiaryFAIL npminstall"; exit 1; }
log "init platforms (cap add + sync)"
sh scripts/init-platforms.sh android || { echo "APPiaryFAIL capadd"; exit 1; }
log "apply-runtime post"
node scripts/apply-runtime.js post android || { echo "APPiaryFAIL post"; exit 1; }
grep -q "PlayGamesSdk.initialize" android/app/src/main/java/com/demo/game/MainActivity.java && log "mainactivity patched"
log "gradle assembleDebug (this is the long part)"
cd android
export ANDROID_HOME="$HOME/android-sdk"
./gradlew assembleDebug --no-daemon -q 2>&1 | tail -20
if ls app/build/outputs/apk/debug/*.apk >/dev/null 2>&1; then
  log "APK built: $(ls app/build/outputs/apk/debug/)"
  echo "APPiaryCOMPILEOK"
else
  echo "APPiaryFAIL gradle"
  exit 1
fi
`;

const sandbox = new TenkiSandbox();
console.log("creating session...");
const session = await sandbox.create({
  name: "appiary-android-compile",
  cpuCores: 4,
  memoryMb: 8192,
  diskSizeGb: 25,
  allowOutbound: true,
  env: { GH: process.env.GITHUB_TOKEN_4 },
  maxDurationMs: 50 * 60 * 1000
});
console.log("session up, writing build script");

// write the script via heredoc, then run detached (exec returns on EOF; the
// build takes many minutes, so we background it and poll the log)
const write = await session.exec(["bash", "-lc", `cat > ~/build.sh <<'APPiaryEOS'\n${VM_SCRIPT}\nAPPiaryEOS\necho "script written: $(wc -l < ~/build.sh) lines"`]);
console.log(stdoutText(write));

const start = await session.exec(["bash", "-lc", "nohup bash ~/build.sh > ~/build.log 2>&1 & echo bg-started"]);
console.log(stdoutText(start));

const deadline = Date.now() + 40 * 60 * 1000;
let lastTail = "";
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 30000));
  const poll = await session.exec(["bash", "-lc", "tail -c 1200 ~/build.log"]);
  const tail = stdoutText(poll);
  if (tail !== lastTail) {
    console.log("--- vm log ---");
    console.log(tail);
    lastTail = tail;
  }
  const done = await session.exec(["bash", "-lc", "grep -c 'APPiaryCOMPILEOK\\|APPiaryFAIL' ~/build.log || true"]);
  if (stdoutText(done).trim() !== "0") {
    const full = await session.exec(["bash", "-lc", "grep -E 'APPiaryCOMPILEOK|APPiaryFAIL|== |error:|BUILD' ~/build.log | tail -40"]);
    console.log("=== FINAL ===");
    console.log(stdoutText(full));
    break;
  }
}
const verdict = await session.exec(["bash", "-lc", "grep -E 'APPiaryCOMPILEOK|APPiaryFAIL' ~/build.log || echo TIMEOUT-NO-MARKER"]);
console.log("VERDICT: " + stdoutText(verdict).trim());
await session.close();
console.log("session closed");
process.exit(0);
