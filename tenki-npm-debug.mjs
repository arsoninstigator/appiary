import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

const sandbox = new TenkiSandbox();
const session = await sandbox.create({
  name: "appiary-npm-debug",
  cpuCores: 4, memoryMb: 8192, diskSizeGb: 25, allowOutbound: true,
  env: { GH: process.env.GITHUB_TOKEN_4 },
  maxDurationMs: 30 * 60 * 1000
});
console.log("session up");

const script = `set -e
cd "$HOME"
rm -rf appiary
git clone -q "https://x-access-token:\${GH}@github.com/tinkerquest/appiary.git" appiary
cd appiary/template
cat > capacitor.config.json <<'CFG'
{"appId":"com.demo.game","appName":"t","version":"0.4.0","permissions":["gameServices","push","camera"],"channel":{"name":"play"}}
CFG
node scripts/apply-runtime.js pre android
echo "=== npm version: $(npm --version)"
node --version
echo "=== package.json:"
cat package.json
echo "=== npm install full output:"
npm install --no-audit --no-fund 2>&1
echo "=== npm exit: $?"
`;
const r = await session.exec(["bash", "-lc", script], { timeoutMs: 8 * 60 * 1000 });
console.log(stdoutText(r));
await session.close();
