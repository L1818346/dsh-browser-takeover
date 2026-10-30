#!/usr/bin/env node
/**
 * install-dev — 把**当前包**挂进 DSH 的 desktop profile（开发用），并注册为 bundle。
 *
 *   node scripts/install-dev.mjs            # 安装 / 同步
 *   node scripts/install-dev.mjs --remove   # 卸载（还原 package.json）
 *   node scripts/install-dev.mjs --check    # 只检查当前状态，不改动
 *
 * 包名从本目录的 package.json 读，换一个包名也能直接用。
 *
 * 为什么要手动做这件事：desktop profile 由 Electron 应用独占管理，
 * `dsh plugin --profile desktop ...` 会被拒绝（"managed exclusively by the Electron application"）。
 *
 * 为什么用 junction 而不是复制：源码目录改了以后重启即生效，不用每次同步；
 * profile 里本来就是这么装的（`link:` 依赖 + 目录联接）。
 */

import { cp, readFile, writeFile, rm, lstat, unlink, symlink, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PROFILE = process.env.DSH_PROFILE || 'desktop';
const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE);
const PKG = JSON.parse(await readFile(join(HERE, 'package.json'), 'utf8'));
const PKG_NAME = PKG.name;
const TARGET = join(PROFILE_DIR, 'node_modules', PKG_NAME);

const mode = process.argv.includes('--remove') ? 'remove'
  : process.argv.includes('--check') ? 'check' : 'install';

if (!existsSync(PROFILE_DIR)) {
  console.error(`profile 不存在：${PROFILE_DIR}`);
  process.exit(2);
}
const pkgPath = join(PROFILE_DIR, 'package.json');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function patchProfile({ add }) {
  const pkg = await readJson(pkgPath);
  const bundles = pkg.dsh?.profile?.bundles ?? [];
  const hasDep = Object.hasOwn(pkg.dependencies ?? {}, PKG_NAME);

  if (add) {
    if (!hasDep) {
      const backup = join(PROFILE_DIR,
        `package.json.bak-${new Date().toISOString().replace(/[:.]/g, '-')}-preinstall`);
      await writeFile(backup, await readFile(pkgPath), 'utf8');
      console.log(`已备份 package.json → ${backup}`);
    }
    pkg.dependencies = { ...(pkg.dependencies ?? {}), [PKG_NAME]: `link:${HERE.replace(/\\/g, '/')}` };
    if (!bundles.includes(PKG_NAME)) pkg.dsh.profile.bundles = [...bundles, PKG_NAME];
  } else {
    if (pkg.dependencies) delete pkg.dependencies[PKG_NAME];
    if (pkg.dsh?.profile?.bundles) {
      pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== PKG_NAME);
    }
  }
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

/** 只删"挂在 node_modules 里的那一个"：是 junction/symlink 就 unlink，绝不跟着链接删源码。 */
async function removeTarget() {
  let st = null;
  try { st = await lstat(TARGET); } catch { return; }
  if (st.isSymbolicLink()) {
    await unlink(TARGET);
  } else {
    await rm(TARGET, { recursive: true, force: true });
  }
}

async function linkTarget() {
  await mkdir(dirname(TARGET), { recursive: true });
  await removeTarget();
  try {
    await symlink(HERE, TARGET, 'junction');
  } catch (e) {
    // 极少数文件系统（网络盘）不支持 junction：退回复制，至少能用
    console.warn(`junction 失败（${e?.message ?? e}），改为复制一份源码`);
    await cp(HERE, TARGET, {
      recursive: true,
      filter: (src) => !['node_modules', '.git', 'test', '.tmp', 'vendor'].includes(src.split(/[\\/]/).pop()),
    });
  }
  let ok = false;
  try { ok = (await stat(TARGET)).isDirectory(); } catch { ok = false; }
  if (!ok) throw new Error(`安装失败：${TARGET} 不存在`);
}

async function report() {
  let installed = false;
  try { installed = (await stat(TARGET)).isDirectory(); } catch { installed = false; }
  const pkg = await readJson(pkgPath);
  const registered = (pkg.dsh?.profile?.bundles ?? []).includes(PKG_NAME);
  const dep = pkg.dependencies?.[PKG_NAME] ?? null;
  console.log(`包名         : ${PKG_NAME}@${PKG.version}`);
  console.log(`profile      : ${PROFILE_DIR}`);
  console.log(`node_modules : ${installed ? '已安装' : '未安装'}  ${TARGET}`);
  console.log(`bundles 注册 : ${registered ? '是' : '否'}`);
  console.log(`dependencies : ${dep ?? '无'}`);
  return { installed, registered, dep };
}

if (mode === 'check') {
  await report();
  process.exit(0);
}

if (mode === 'remove') {
  await removeTarget();
  await patchProfile({ add: false });
  console.log('已卸载。重启 DSH 生效（tool 会消失）。');
  await report();
  process.exit(0);
}

await linkTarget();
await patchProfile({ add: true });
await report();
console.log('\n完成。重启 DSH Desktop 后生效（插件树在进程启动时组合）。');
