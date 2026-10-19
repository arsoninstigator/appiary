import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

const sandbox = new TenkiSandbox();
const session = await sandbox.create({
  name: "appiary-gradle-debug",
  cpuCores: 4, memoryMb: 8192, diskSizeGb: 25, allowOutbound: true,
  env: { GH: process.env.GITHUB_TOKEN_4 },
  maxDurationMs: 40 * 60 * 1000
});
console.log("session up");

const script = `set -eu
export DEBIAN_FRONTEND=noninteractive
sudo -n apt-get update -qq >/dev/null
sudo -n apt-get install -y -qq openjdk-21-jdk-headless unzip git curl >/dev/null
mkdir -p "$HOME/android-sdk/cmdline-tools"
cd "$HOME/android-sdk"
curl -fsSL -o clt.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q clt.zip -d cmdline-tools
mv cmdline-tools/cmdline-tools cmdline-tools/latest
export ANDROID_HOME="$HOME/android-sdk"
yes | cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null 2>&1
cmdline-tools/latest/bin/sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools" >/dev/null 2>&1
cd "$HOME"
rm -rf appiary
git clone -q "https://x-access-token:\${GH}@github.com/tinkerquest/appiary.git" appiary
cd appiary/template
cat > capacitor.config.json <<'CFG'
{"appId":"com.demo.game","appName":"t","version":"0.4.0","permissions":["gameServices","push","camera"],"channel":{"name":"play"}}
CFG
node scripts/apply-runtime.js pre android
npm install --no-audit --no-fund >/dev/null 2>&1
sh scripts/init-platforms.sh android 2>&1 | tail -3
node scripts/apply-runtime.js post android
echo "=== generated plugin wiring:"
cat android/capacitor.settings.gradle 2>/dev/null || true
ls android/app/libs 2>/dev/null || true
cd android
echo "=== gradle failure detail:"
./gradlew assembleDebug --no-daemon 2>&1 | grep -B3 -A25 -i "error\\|failed" | head -100
`;
const r = await session.exec(["bash", "-lc", script], { timeoutMs: 20 * 60 * 1000 });
console.log(stdoutText(r));
await session.close();
