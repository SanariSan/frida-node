const { prompt } = require('inquirer');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function pushFile(devicesArr) {
  for (let id of devicesArr) {
    await exec(`./platform-tools/adb -s ${id} push ./etc/file.name /sdcard/Download/`);
  }
}

async function pushFridaServer(devicesArr, localFridaServerName) {
  for (let id of devicesArr) {
    await exec(
      `./platform-tools/adb -s ${id} push ./etc/frida-server-15.1.14-android-arm /data/local/tmp/${localFridaServerName}`,
    );
    await exec(
      `./platform-tools/adb -s ${id} shell "su -c chown root:root /data/local/tmp/${localFridaServerName}"`,
    );
    await exec(
      `./platform-tools/adb -s ${id} shell "su -c chmod 775 /data/local/tmp/${localFridaServerName}"`,
    );
  }
}

async function tapAction(devicesArr) {
  await prompt({
    message: `Query screen sizes?`,
    type: 'confirm',
    name: 'name',
  });

  const devicesWithSizes = {};

  for (let id of devicesArr) {
    // default for fail cases, most my devices of that size
    devicesWithSizes[id] = { x: 720, y: 1280 };

    const response = await exec(`./platform-tools/adb -s ${id} shell wm size`).catch(() => {});
    if (!response || !response.stdout) return;

    const parsed = response.stdout.match(/\d+x\d+/gm);
    if (parsed === null) return;

    const [x, y] = parsed[0].split('x');
    devicesWithSizes[id] = { x, y };
  }

  console.dir(devicesWithSizes, { depth: 2 });

  const getTargetX = (x) => ((x / 100) * 76.4).toFixed(3);
  const getTargetY = (y) => ((y / 100) * 87.5).toFixed(3);

  await prompt({
    message: `Tap?`,
    type: 'confirm',
    name: 'name',
  });

  for (let [id, sizes] of Object.entries(devicesWithSizes)) {
    const { x, y } = sizes;
    void exec(`./platform-tools/adb -s ${id} shell input tap ${getTargetX(x)} ${getTargetY(y)}`);
  }
}

async function getDevices() {
  const devicesOutput = await exec('./platform-tools/adb devices');
  const devicesArr = devicesOutput.stdout
    .trim()
    .split('\n')
    .slice(1)
    .map((el) => el.split('\t')[0]);

  console.log('Devices:');
  console.log(devicesArr);

  return devicesArr;
}

function killApp(devicesArr, appName) {
  console.log('---');
  console.log('Closing app');
  console.log('---');

  for (let id of devicesArr) {
    void exec(`./platform-tools/adb -s ${id} shell "su -c pkill ${appName}"`).catch(() => {});
    // void exec(`./platform-tools/adb -s ${id} shell am force-stop ${packageName}`).catch(() => {});
    console.log('%s | %s', id, 'OK');
  }
}

function launchApp(devicesArr, packageName) {
  console.log('---');
  console.log('Launching app');
  console.log('---');

  for (let id of devicesArr) {
    void exec(`./platform-tools/adb -s ${id} shell monkey -p ${packageName} 1`).catch(() => {});
    console.log('%s | %s', id, 'OK');
  }
}

function attachFrida(devicesArr, appName) {
  console.log('---');
  console.log('Launching frida');
  console.log('---');

  for (let id of devicesArr) {
    void exec(`frida -D ${id} -n ${appName} -l ./etc/frida-script-targeted.js --no-pause`).catch(
      () => {},
    );
    console.log('%s | %s', id, 'OK');
  }
}

async function findFridaServerPS(devicesArr, localFridaServerName) {
  console.log('---');
  console.log('Looking for frida server');
  console.log('---');

  for (let id of devicesArr) {
    const findFridaServerOutput = await exec(
      `./platform-tools/adb -s ${id} shell "su -c ps | grep ${localFridaServerName}"`,
    ).catch((e) => {
      console.log('%s | %s', id, 'NOT FOUND');
    });

    if (findFridaServerOutput) console.log('%s | %s', id, findFridaServerOutput.stdout.trim());
  }
}

async function killFridaServerPS(devicesArr, localFridaServerName) {
  console.log('---');
  console.log('Killing frida server');
  console.log('---');

  for (let id of devicesArr) {
    void exec(`./platform-tools/adb -s ${id} shell "su -c pkill ${localFridaServerName}"`).catch(
      () => {},
    );
    console.log('%s | %s', id, 'OK');
  }
}

async function startFridaServerPS(devicesArr, localFridaServerName) {
  console.log('---');
  console.log('Starting frida server');
  console.log('---');

  for (let id of devicesArr) {
    void exec(
      `./platform-tools/adb -s ${id} shell "su -c nohup /data/local/tmp/${localFridaServerName} > /dev/null 2>&1 &"`,
    );
    console.log('%s | %s', id, 'OK');
  }
}

async function restartFridaServerPS(devicesArr, localFridaServerName) {
  await findFridaServerPS(devicesArr, localFridaServerName);

  void killFridaServerPS(devicesArr, localFridaServerName);

  await sleep(10000);
  await findFridaServerPS(devicesArr, localFridaServerName);

  void startFridaServerPS(devicesArr, localFridaServerName);

  await sleep(10000);
  await findFridaServerPS(devicesArr, localFridaServerName);
}

async function init() {
  const appName = process.env.APP_NAME;
  const packageName = process.env.PACKAGE_NAME;
  const localFridaServerName = process.env.LOCAL_FRIDA_SERVER_NAME;

  await exec('./platform-tools/adb start-server');

  const devicesArr = await getDevices();

  await restartFridaServerPS(devicesArr, localFridaServerName);

  void launchApp(devicesArr, packageName);
  await sleep(5000);
  void attachFrida(devicesArr, appName);

  // void killApp(devicesArr, appName);
  // void tapAction(devicesArr);
}

init();
